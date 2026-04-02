import { Router } from 'express'
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

// POST /api/chat
chatRouter.post('/chat', (req, res) => {
  const { message, page_url, model } = req.body as { message?: string; page_url?: string; model?: string }
  if (!message?.trim()) { res.status(400).json({ error: 'message required' }); return }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const docsDir = req.app.locals.docsDir as string
  const claudeSessionId = getMeta('claude_session_id')
  const systemPrompt = buildSystemPrompt(docsDir)

  // Prepend current page context so Claude knows which page the user is viewing
  const fullMessage = page_url
    ? `[Viewing page: ${page_url}]\n\n${message}`
    : message

  const ac = new AbortController()
  res.on('close', () => ac.abort())

  spawnClaude({
    message: fullMessage,
    claudeSessionId,
    model: model ?? null,
    systemPrompt,
    cwd: docsDir,
    res,
    signal: ac.signal,
    onSessionId: (id) => setMeta('claude_session_id', id),
    onError: (err) => {
      if (err.code === 'session_expired' || err.code === 'context_limit') {
        deleteMeta('claude_session_id')
      }
    },
  })
})

// GET /api/chat/session
chatRouter.get('/chat/session', (req, res) => {
  res.json({ sessionId: getMeta('claude_session_id') })
})

// DELETE /api/chat/session
chatRouter.delete('/chat/session', (req, res) => {
  deleteMeta('claude_session_id')
  res.json({ ok: true })
})
