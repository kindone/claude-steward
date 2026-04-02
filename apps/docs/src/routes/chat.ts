import { Router, type Response } from 'express'
import { DatabaseSync } from 'node:sqlite'
import { spawnClaude } from '../claude/spawn.js'
import { buildSystemPrompt } from '../claude/system-prompt.js'

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

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/chat
chatRouter.post('/chat', (req, res) => {
  const { message, page_url, model } = req.body as { message?: string; page_url?: string; model?: string }
  if (!message?.trim()) { res.status(400).json({ error: 'message required' }); return }

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
  const claudeSessionId = getMeta('claude_session_id')
  const systemPrompt = buildSystemPrompt(docsDir)
  const fullMessage = page_url ? `[Viewing page: ${page_url}]\n\n${message}` : message

  const ac = new AbortController()
  const job: ActiveJob = { events: [], done: false, subscribers: new Set(), abort: () => ac.abort() }
  _activeJob = job

  // Attach first subscriber — but do NOT abort on disconnect.
  // Claude keeps running through browser reloads (e.g. MkDocs live-reload).
  attachSubscriber(job, res)

  spawnClaude({
    message: fullMessage,
    claudeSessionId,
    model: model ?? null,
    systemPrompt,
    cwd: docsDir,
    signal: ac.signal,
    onEvent:     (event, data) => broadcast(job, event, data),
    onEnd:       () => { job.done = true; job.subscribers.clear() },
    onSessionId: (id) => setMeta('claude_session_id', id),
    onError:     (err) => {
      if (err.code === 'session_expired' || err.code === 'context_limit') {
        deleteMeta('claude_session_id')
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
  res.json({ active: !!getRunningJob() })
})

// GET /api/chat/session
chatRouter.get('/chat/session', (_req, res) => {
  res.json({ sessionId: getMeta('claude_session_id') })
})

// DELETE /api/chat/session — clear session and abort any running job
chatRouter.delete('/chat/session', (_req, res) => {
  deleteMeta('claude_session_id')
  _activeJob?.abort()
  if (_activeJob) _activeJob.done = true
  res.json({ ok: true })
})
