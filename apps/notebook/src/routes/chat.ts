import { Router } from 'express'
import { listCells, getMeta, setMeta, deleteMeta } from '../db.js'
import { spawnClaude } from '../claude/spawn.js'
import { buildSystemPrompt } from '../claude/system-prompt.js'
import { addSseClient, removeSseClient } from '../sse.js'

export const chatRouter = Router()

// POST /api/chat — SSE stream, spawns Claude CLI
chatRouter.post('/chat', (req, res) => {
  const { message } = req.body as { message?: string }
  if (!message?.trim()) { res.status(400).json({ error: 'message required' }); return }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // Add to SSE clients so cell:updated events are also delivered on this stream
  addSseClient(res)
  res.on('close', () => removeSseClient(res))

  const dataDir = req.app.locals.dataDir as string
  const port = req.socket.localPort ?? 4001

  const cells = listCells()
  const claudeSessionId = getMeta('claude_session_id')
  const systemPrompt = buildSystemPrompt(cells, port)

  const ac = new AbortController()
  res.on('close', () => ac.abort())

  spawnClaude({
    message,
    claudeSessionId,
    systemPrompt,
    cwd: dataDir,
    res,
    signal: ac.signal,
    onSessionId: (id) => {
      setMeta('claude_session_id', id)
    },
    onError: (err) => {
      if (err.code === 'session_expired' || err.code === 'context_limit') {
        deleteMeta('claude_session_id')
      }
    },
  })
})

// GET /api/chat/session
chatRouter.get('/chat/session', (_req, res) => {
  res.json({ sessionId: getMeta('claude_session_id') })
})

// DELETE /api/chat/session — start fresh
chatRouter.delete('/chat/session', (_req, res) => {
  deleteMeta('claude_session_id')
  res.json({ ok: true })
})
