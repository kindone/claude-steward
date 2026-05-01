import fs from 'node:fs'
import { Router, type Response } from 'express'
import { DatabaseSync } from 'node:sqlite'
import { spawnCliJob } from '../cli/spawn.js'
import { buildSystemPrompt } from '../claude/system-prompt.js'
import { adapters, defaultCliName, normalizeCliName, type CliAdapter, type CliName } from '../cli/index.js'

export const chatRouter = Router()

let _db: DatabaseSync | null = null

export function initChatDb(db: DatabaseSync): void {
  _db = db
}

function db(): DatabaseSync {
  if (!_db) throw new Error('Chat DB not initialised')
  return _db
}

function getMeta(key: string): string | null {
  const row = db().prepare('SELECT value FROM docs_meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

function setMeta(key: string, value: string): void {
  db().prepare('INSERT OR REPLACE INTO docs_meta (key, value) VALUES (?, ?)').run(key, value)
}

function deleteMeta(key: string): void {
  db().prepare('DELETE FROM docs_meta WHERE key = ?').run(key)
}

// ── Active job ────────────────────────────────────────────────────────────────
// A single Claude process can outlive the HTTP response that started it.
// When the browser disconnects (e.g. MkDocs live-reload) we keep Claude running
// and buffer events so a reconnecting client can replay and catch up.

interface ActiveJob {
  events: Array<{ event: string; data: unknown }>  // full buffer for replay
  done: boolean
  subscribers: Set<Response>
  abort: () => void
  cli: CliName
}

let _activeJob: ActiveJob | null = null

function getRunningJob(): ActiveJob | null {
  return _activeJob && !_activeJob.done ? _activeJob : null
}

/** Write one SSE frame to a single response, ignoring destroyed/ended connections. */
function writeSse(res: Response, event: string, data: unknown): boolean {
  if (res.writableEnded || res.destroyed) return false
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    return true
  } catch {
    return false
  }
}

/** Broadcast one event to all subscribers and append to the job buffer. */
function broadcast(job: ActiveJob, event: string, data: unknown): void {
  job.events.push({ event, data })
  for (const r of [...job.subscribers]) {
    if (!writeSse(r, event, data)) job.subscribers.delete(r)
  }
}

/** Replay the full buffer to a new subscriber, then keep it subscribed. */
function attachSubscriber(job: ActiveJob, res: Response): void {
  for (const { event, data } of job.events) {
    if (!writeSse(res, event, data)) return  // res died during replay
  }
  job.subscribers.add(res)
  res.on('close', () => job.subscribers.delete(res))
}

function finishJob(job: ActiveJob): void {
  job.done = true
  for (const res of [...job.subscribers]) {
    if (!res.writableEnded && !res.destroyed) res.end()
  }
  job.subscribers.clear()
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/chat
chatRouter.post('/chat', (req, res) => {
  const { message, page_url, model, cli: cliRaw } = req.body as { message?: string; page_url?: string; model?: string; cli?: string }
  if (!message?.trim()) { res.status(400).json({ error: 'message required' }); return }
  const cli = normalizeCliName(cliRaw ?? defaultCliName())

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // If Claude is already running (e.g. browser reconnected after live-reload),
  // subscribe to the existing job — replay buffered events then stream live.
  const running = getRunningJob()
  if (running) {
    attachSubscriber(running, res)
    return
  }

  const docsDir = req.app.locals.docsDir as string
  const sessionKey = sessionMetaKey(cli)
  const modelKey = modelMetaKey(cli)
  const requestedModel = model ?? null
  const storedModel = getMeta(modelKey)
  let cliSessionId = getMeta(sessionKey)
  if (cliSessionId && storedModel !== null && storedModel !== modelStorageValue(requestedModel)) {
    deleteMeta(sessionKey)
    cliSessionId = null
  }
  const systemPrompt = buildSystemPrompt(docsDir)
  const fullMessage = page_url ? `[Viewing page: ${page_url}]\n\n${message}` : message

  const ac = new AbortController()
  const job: ActiveJob = { events: [], done: false, subscribers: new Set(), abort: () => ac.abort(), cli }
  _activeJob = job

  // Attach first subscriber — but do NOT abort on disconnect.
  // Claude keeps running through browser reloads (e.g. MkDocs live-reload).
  attachSubscriber(job, res)

  spawnCliJob({
    cli,
    prompt: fullMessage,
    resumeId: cliSessionId,
    model: requestedModel,
    systemPrompt,
    cwd: docsDir,
    signal: ac.signal,
    onEvent:     (event, data) => broadcast(job, event, data),
    onEnd:       () => finishJob(job),
    onSessionId: (id) => {
      setMeta(sessionKey, id)
      setMeta(modelKey, modelStorageValue(requestedModel))
    },
    onError:     (err) => {
      if (err.code === 'session_expired' || err.code === 'context_limit') {
        deleteMeta(sessionKey)
      }
    },
  })
})

// GET /api/chat/reconnect
// Browser calls this after a live-reload to reattach to a running job.
// Returns the full buffered event stream so the client can replay from the start.
chatRouter.get('/chat/reconnect', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const running = getRunningJob()
  if (!running) {
    // Nothing to reconnect to — tell the client it's safe to treat as done
    writeSse(res, 'done', { session_id: '' })
    res.end()
    return
  }

  attachSubscriber(running, res)
})

// GET /api/chat/status
chatRouter.get('/chat/status', (_req, res) => {
  const job = getRunningJob()
  res.json({ active: !!job, cli: job?.cli ?? null })
})

type AdapterMeta = {
  label: string
  available: boolean
  models: CliAdapter['models']
  capabilities: CliAdapter['capabilities']
}

// GET /api/chat/meta
chatRouter.get('/chat/meta', (req, res) => {
  const meta: Record<CliName, AdapterMeta> = {} as Record<CliName, AdapterMeta>
  for (const [name, adapter] of Object.entries(adapters) as Array<[CliName, CliAdapter]>) {
    let available = false
    try {
      available = fs.existsSync(adapter.binaryPath())
    } catch {
      available = false
    }
    meta[name] = {
      label: adapter.label,
      available,
      models: adapter.models,
      capabilities: adapter.capabilities,
    }
  }
  // docsDir is used by chat-panel.js to namespace localStorage keys,
  // ensuring two different docs apps that run on the same slot (port/origin)
  // never mix their chat history.
  const docsDir: string = req.app.locals.docsDir ?? ''
  res.json({ defaultCli: defaultCliName(), adapters: meta, docsDir })
})

// GET /api/chat/session
chatRouter.get('/chat/session', (_req, res) => {
  res.json({
    sessionId: getMeta('claude_session_id'),
    sessions: {
      claude: getMeta('claude_session_id'),
      opencode: getMeta(sessionMetaKey('opencode')),
    },
  })
})

// DELETE /api/chat/session — clear session and abort any running job
chatRouter.delete('/chat/session', (_req, res) => {
  deleteMeta('claude_session_id')
  deleteMeta(modelMetaKey('claude'))
  deleteMeta(sessionMetaKey('opencode'))
  deleteMeta(modelMetaKey('opencode'))
  _activeJob?.abort()
  if (_activeJob) finishJob(_activeJob)
  res.json({ ok: true })
})

function sessionMetaKey(cli: CliName): string {
  return cli === 'claude' ? 'claude_session_id' : `cli_session_${cli}`
}

function modelMetaKey(cli: CliName): string {
  return cli === 'claude' ? 'claude_model' : `cli_model_${cli}`
}

function modelStorageValue(model: string | null): string {
  return model ?? '__default__'
}
