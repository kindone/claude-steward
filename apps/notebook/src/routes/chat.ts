import { Router } from 'express'
import { listCells, getNotebook, updateNotebook } from '../db.js'
import { spawnClaude } from '../claude/spawn.js'
import { buildSystemPrompt } from '../claude/system-prompt.js'
import { addSseClient, removeSseClient } from '../sse.js'

export const chatRouter = Router()

// POST /api/notebooks/:notebookId/chat — SSE stream, spawns Claude CLI
chatRouter.post('/notebooks/:notebookId/chat', (req, res) => {
  const { notebookId } = req.params
  const { message } = req.body as { message?: string }
  if (!message?.trim()) { res.status(400).json({ error: 'message required' }); return }

  const nb = getNotebook(notebookId)
  if (!nb) { res.status(404).json({ error: 'Notebook not found' }); return }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // Add to SSE clients so cell:updated events are delivered on this stream too
  addSseClient(res)
  res.on('close', () => removeSseClient(res))

  const dataDir = req.app.locals.dataDir as string
  const port = req.socket.localPort ?? 4001

  const cells = listCells(notebookId)
  const systemPrompt = buildSystemPrompt(cells, port)

  const ac = new AbortController()
  res.on('close', () => ac.abort())

  spawnClaude({
    message,
    claudeSessionId: nb.claude_session_id,
    systemPrompt,
    cwd: dataDir,
    res,
    signal: ac.signal,
    onSessionId: (id) => {
      updateNotebook(notebookId, { claude_session_id: id })
    },
    onError: (err) => {
      if (err.code === 'session_expired' || err.code === 'context_limit') {
        updateNotebook(notebookId, { claude_session_id: null })
      }
    },
  })
})

// GET /api/notebooks/:notebookId/chat/session
chatRouter.get('/notebooks/:notebookId/chat/session', (req, res) => {
  const nb = getNotebook(req.params.notebookId)
  if (!nb) { res.status(404).json({ error: 'Notebook not found' }); return }
  res.json({ sessionId: nb.claude_session_id })
})

// DELETE /api/notebooks/:notebookId/chat/session — start fresh
chatRouter.delete('/notebooks/:notebookId/chat/session', (req, res) => {
  const nb = getNotebook(req.params.notebookId)
  if (!nb) { res.status(404).json({ error: 'Notebook not found' }); return }
  updateNotebook(req.params.notebookId, { claude_session_id: null })
  res.json({ ok: true })
})
