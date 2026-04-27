import { Router } from 'express'
import {
  listCells, getNotebook,
  listChatSessions, getChatSession, createChatSession, updateChatSession, deleteChatSession,
  listChatMessages, saveChatMessage, clearChatMessages,
} from '../db.js'
import { spawnClaude, runClaudePrompt } from '../claude/spawn.js'
import { buildSystemPrompt } from '../claude/system-prompt.js'
import { writeMcpConfig } from '../mcp/config.js'
import { addSseClient, removeSseClient } from '../sse.js'

export const chatRouter = Router()

// ── Session CRUD ──────────────────────────────────────────────────────────────

// GET /api/notebooks/:notebookId/chat/sessions
chatRouter.get('/notebooks/:notebookId/chat/sessions', (req, res) => {
  if (!getNotebook(req.params.notebookId)) { res.status(404).json({ error: 'Notebook not found' }); return }
  res.json(listChatSessions(req.params.notebookId))
})

// POST /api/notebooks/:notebookId/chat/sessions
chatRouter.post('/notebooks/:notebookId/chat/sessions', (req, res) => {
  if (!getNotebook(req.params.notebookId)) { res.status(404).json({ error: 'Notebook not found' }); return }
  const session = createChatSession(req.params.notebookId)
  res.status(201).json(session)
})

// DELETE /api/notebooks/:notebookId/chat/sessions/:sessionId
chatRouter.delete('/notebooks/:notebookId/chat/sessions/:sessionId', (req, res) => {
  const session = getChatSession(req.params.sessionId)
  if (!session || session.notebook_id !== req.params.notebookId) {
    res.status(404).json({ error: 'Session not found' }); return
  }
  deleteChatSession(req.params.sessionId)
  res.json({ ok: true })
})

// ── Messages ──────────────────────────────────────────────────────────────────

// GET /api/notebooks/:notebookId/chat/messages?sessionId=...
chatRouter.get('/notebooks/:notebookId/chat/messages', (req, res) => {
  const sessionId = req.query.sessionId as string | undefined
  if (!sessionId) { res.status(400).json({ error: 'sessionId query param required' }); return }
  const session = getChatSession(sessionId)
  if (!session || session.notebook_id !== req.params.notebookId) {
    res.status(404).json({ error: 'Session not found' }); return
  }
  const rows = listChatMessages(sessionId)
  const compactTs: number[] = session.compact_timestamps ? JSON.parse(session.compact_timestamps) : []

  // Interleave synthetic divider objects at each compact boundary
  type MsgOut = { id: string; role: string; content: string; toolCalls: unknown[]; isError: boolean }
  const messages: MsgOut[] = []
  let tsIdx = 0
  for (const r of rows) {
    while (tsIdx < compactTs.length && compactTs[tsIdx] <= r.created_at) {
      messages.push({ id: `divider-${compactTs[tsIdx]}`, role: 'divider', content: '', toolCalls: [], isError: false })
      tsIdx++
    }
    messages.push({ id: r.id, role: r.role, content: r.content, toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : [], isError: r.is_error === 1 })
  }
  // Any remaining timestamps after the last message
  while (tsIdx < compactTs.length) {
    messages.push({ id: `divider-${compactTs[tsIdx]}`, role: 'divider', content: '', toolCalls: [], isError: false })
    tsIdx++
  }

  res.json(messages)
})

// ── Compact endpoint ──────────────────────────────────────────────────────────

// POST /api/notebooks/:notebookId/chat/compact
chatRouter.post('/notebooks/:notebookId/chat/compact', async (req, res) => {
  const { notebookId } = req.params
  const { sessionId } = req.body as { sessionId?: string }
  if (!sessionId) { res.status(400).json({ error: 'sessionId required' }); return }

  const nb = getNotebook(notebookId)
  if (!nb) { res.status(404).json({ error: 'Notebook not found' }); return }

  const session = getChatSession(sessionId)
  if (!session || session.notebook_id !== notebookId) {
    res.status(404).json({ error: 'Session not found' }); return
  }

  const rows = listChatMessages(sessionId)
  const relevant = rows.filter(r => !r.is_error && r.content.trim())
  if (relevant.length === 0) {
    res.status(400).json({ error: 'No messages to compact' }); return
  }

  const CHAR_LIMIT = 80_000
  const lines = relevant.map(r => `${r.role === 'user' ? 'User' : 'Assistant'}: ${r.content.trim()}`)
  let chars = 0
  let startIdx = lines.length
  while (startIdx > 0 && chars + lines[startIdx - 1].length + 2 < CHAR_LIMIT) {
    startIdx--
    chars += lines[startIdx].length + 2
  }
  const skipped = startIdx
  const transcript = (skipped > 0 ? [`[${skipped} earlier message(s) omitted for length]`, ''] : [])
    .concat(lines.slice(startIdx))
    .join('\n\n')

  const prompt = [
    'Summarize the following conversation concisely but completely.',
    'The summary will prime a new session so the conversation can continue naturally.',
    'Include all important facts, decisions, code changes, and open questions.',
    '',
    'Conversation:',
    '',
    transcript,
    '',
    'Summary:',
  ].join('\n')

  let summary: string
  try {
    summary = await runClaudePrompt(prompt)
  } catch (err) {
    console.error('[compact] summarization failed:', err)
    res.status(500).json({ error: 'Failed to generate summary' }); return
  }

  // Store summary in system_prompt, record compact timestamp, reset claude session ID
  const basePrompt = session.system_prompt ? `${session.system_prompt}\n\n---\n\n` : ''
  const prevTs: number[] = session.compact_timestamps ? JSON.parse(session.compact_timestamps) : []
  const nowTs = Math.floor(Date.now() / 1000)
  updateChatSession(sessionId, {
    system_prompt: `${basePrompt}Previous conversation summary:\n${summary.trim()}`,
    claude_session_id: null,
    compact_timestamps: JSON.stringify([...prevTs, nowTs]),
  })

  res.json({ ok: true, sessionId })
})

// ── Main chat endpoint ────────────────────────────────────────────────────────

// POST /api/notebooks/:notebookId/chat
chatRouter.post('/notebooks/:notebookId/chat', (req, res) => {
  const { notebookId } = req.params
  const { message, sessionId, model } = req.body as { message?: string; sessionId?: string; model?: string }
  if (!message?.trim()) { res.status(400).json({ error: 'message required' }); return }
  if (!sessionId) { res.status(400).json({ error: 'sessionId required' }); return }

  const nb = getNotebook(notebookId)
  if (!nb) { res.status(404).json({ error: 'Notebook not found' }); return }

  const session = getChatSession(sessionId)
  if (!session || session.notebook_id !== notebookId) {
    res.status(404).json({ error: 'Session not found' }); return
  }

  // Auto-title the session from the first user message
  if (session.title === 'New chat') {
    const title = message.trim().slice(0, 40) + (message.trim().length > 40 ? '…' : '')
    updateChatSession(sessionId, { title })
  }

  // Persist the user message immediately
  saveChatMessage(notebookId, sessionId, { role: 'user', content: message })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  addSseClient(res)
  res.on('close', () => removeSseClient(res))

  const dataDir = req.app.locals.dataDir as string
  const port = req.socket.localPort ?? 4001

  const cells = listCells(notebookId)
  // Prepend any compact summary stored on the session (from compaction)
  const baseSystemPrompt = buildSystemPrompt(cells, port)
  const systemPrompt = session.system_prompt
    ? `${session.system_prompt}\n\n---\n\n${baseSystemPrompt}`
    : baseSystemPrompt
  const mcpConfigPath = writeMcpConfig(dataDir, port, notebookId)

  const ac = new AbortController()

  let accText = ''
  const toolCalls: unknown[] = []
  let completed = false

  // Persist whatever we have accumulated when the client disconnects mid-stream
  const persistPartial = (isError: boolean, errorMessage?: string) => {
    if (completed) return
    completed = true
    const content = errorMessage || accText
    if (content) {
      saveChatMessage(notebookId, sessionId, {
        role: 'assistant',
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        isError,
      })
    }
  }

  res.on('close', () => {
    ac.abort()
    // Client disconnected before done — persist whatever arrived
    persistPartial(false)
  })

  spawnClaude({
    message,
    claudeSessionId: session.claude_session_id,
    systemPrompt,
    cwd: dataDir,
    res,
    signal: ac.signal,
    mcpConfigPath,
    model: model || null,
    onSessionId: (id) => {
      updateChatSession(sessionId, { claude_session_id: id })
    },
    onChunk: (chunk: Record<string, unknown>) => {
      if (chunk.type === 'stream_event') {
        const evt = chunk.event as Record<string, unknown>
        if (evt?.type === 'content_block_delta') {
          const delta = evt.delta as Record<string, unknown>
          if (delta?.type === 'text_delta') accText += delta.text as string
        }
      }
      if (chunk.type === 'assistant') {
        const content = (chunk.message as Record<string, unknown>)?.content as Array<Record<string, unknown>>
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use') toolCalls.push(block)
          }
        }
      }
    },
    onComplete: () => {
      persistPartial(false)
    },
    onError: (err) => {
      if (err.code === 'session_expired' || err.code === 'context_limit') {
        updateChatSession(sessionId, { claude_session_id: null })
      }
      persistPartial(true, err.message || accText || 'Unknown error')
    },
  })
})
