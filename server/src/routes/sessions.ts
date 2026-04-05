import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { sessionQueries, messageQueries, projectQueries, scheduleQueries, type PermissionMode } from '../db/index.js'
import { addWatcher, removeWatcher, addSubscriber, removeSubscriber } from '../lib/sessionWatchers.js'
import { runClaudePrompt } from '../claude/process.js'

const VALID_MODES = new Set<PermissionMode>(['default', 'plan', 'acceptEdits', 'bypassPermissions'])

const router = Router()

router.get('/', (req, res) => {
  const { projectId } = req.query as { projectId?: string }
  const sessions = projectId
    ? sessionQueries.listByProject(projectId)
    : sessionQueries.list()
  res.json(sessions)
})

router.post('/', (req, res) => {
  const { projectId } = req.body as { projectId?: string }
  if (!projectId || typeof projectId !== 'string') {
    res.status(400).json({ error: 'projectId is required' })
    return
  }
  const id = uuidv4()
  const project = projectQueries.findById(projectId)
  const session = sessionQueries.create(id, 'New Chat', projectId, project?.system_prompt)
  res.status(201).json(session)
})

// GET /api/sessions/:id/watch
// SSE endpoint: fires `event: done` the moment the Claude response lands in the DB.
// If the response is already there, replies immediately. Otherwise parks until
// notifyWatchers() is called from the chat route's onComplete handler.
// Sends `: ping` comments every 30 s to keep the connection alive through nginx.
router.get('/:id/watch', (req, res) => {
  const session = sessionQueries.findById(req.params.id)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  // If the last message is already a completed assistant message, reply immediately.
  // Do NOT short-circuit on status='streaming' — the job is still in progress and
  // the client must park here until notifyWatchers() fires on completion.
  const messages = messageQueries.listPaged(req.params.id, 1)
  const last = messages[messages.length - 1]
  if (messages.length > 0 && last.role === 'assistant' && last.status !== 'streaming') {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    res.write('event: done\ndata: {}\n\n')
    res.end()
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  addWatcher(req.params.id, res)

  // Keep the connection alive through nginx's idle timeout (default 60 s).
  const keepalive = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n')
  }, 30_000)

  res.on('close', () => {
    clearInterval(keepalive)
    removeWatcher(req.params.id, res)
    if (!res.writableEnded) res.end()
  })
})

// GET /api/sessions/:id/subscribe
// Persistent SSE subscription for multi-client sync. Stays open indefinitely and fires
// `event: updated` whenever any message is finalized for this session, so all open tabs
// can re-fetch and stay in sync without polling.
router.get('/:id/subscribe', (req, res) => {
  const session = sessionQueries.findById(req.params.id)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  addSubscriber(req.params.id, res)

  const keepalive = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n')
  }, 30_000)

  res.on('close', () => {
    clearInterval(keepalive)
    removeSubscriber(req.params.id, res)
    if (!res.writableEnded) res.end()
  })
})

router.get('/:id/messages', (req, res) => {
  const session = sessionQueries.findById(req.params.id)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  const { limit: limitStr, before } = req.query as { limit?: string; before?: string }

  // Paginated path: ?limit=N (and optionally ?before=<messageId>)
  if (limitStr !== undefined) {
    const limit = Math.max(1, Math.min(parseInt(limitStr, 10) || 50, 200))
    const rows = messageQueries.listPaged(req.params.id, limit + 1, before)
    const hasMore = rows.length > limit
    res.json({ messages: hasMore ? rows.slice(1) : rows, hasMore })
    return
  }

  // Legacy path (no params): return full array — used internally and by tests
  res.json(messageQueries.listBySessionId(req.params.id))
})

router.patch('/:id', (req, res) => {
  const session = sessionQueries.findById(req.params.id)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }
  const { title, systemPrompt, permissionMode, timezone, model } = req.body as { title?: string; systemPrompt?: string | null; permissionMode?: string; timezone?: string; model?: string | null }

  if (title !== undefined) {
    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'title must be a non-empty string' })
      return
    }
    sessionQueries.updateTitle(title.trim(), req.params.id)
    session.title = title.trim()
  }

  if (systemPrompt !== undefined) {
    const value = typeof systemPrompt === 'string' && systemPrompt.trim()
      ? systemPrompt.trim()
      : null
    sessionQueries.updateSystemPrompt(value, req.params.id)
    session.system_prompt = value
  }

  if (permissionMode !== undefined) {
    if (!VALID_MODES.has(permissionMode as PermissionMode)) {
      res.status(400).json({ error: `permissionMode must be one of: ${[...VALID_MODES].join(', ')}` })
      return
    }
    sessionQueries.updatePermissionMode(permissionMode as PermissionMode, req.params.id)
    session.permission_mode = permissionMode as PermissionMode
  }

  if (timezone !== undefined && typeof timezone === 'string' && timezone.trim()) {
    sessionQueries.updateTimezone(timezone.trim(), req.params.id)
    session.timezone = timezone.trim()
  }

  if (model !== undefined) {
    const value = typeof model === 'string' && model.trim() ? model.trim() : null
    sessionQueries.updateModel(value, req.params.id)
    session.model = value
  }

  res.json(session)
})

router.post('/:id/compact', async (req, res) => {
  const session = sessionQueries.findById(req.params.id)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  const messages = messageQueries.listBySessionId(req.params.id)
  const relevant = messages.filter((m) => !m.is_error && m.content.trim())
  if (relevant.length === 0) {
    res.status(400).json({ error: 'No messages to compact' })
    return
  }

  const transcript = relevant
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.trim()}`)
    .join('\n\n')

  const prompt = [
    'Summarize the following conversation concisely but completely.',
    'The summary will prime a new session so the conversation can continue naturally.',
    'Include all important facts, decisions, code changes, file paths, and open questions.',
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
    res.status(500).json({ error: 'Failed to generate summary' })
    return
  }

  const newId = uuidv4()
  const basePrompt = session.system_prompt ? `${session.system_prompt}\n\n---\n\n` : ''
  const summaryTrimmed = summary.trim()
  const systemPrompt = `${basePrompt}Previous conversation summary:\n${summaryTrimmed}`
  const newSession = sessionQueries.create(newId, `[Compacted] ${session.title}`, session.project_id, systemPrompt)
  if (session.permission_mode !== 'acceptEdits') {
    sessionQueries.updatePermissionMode(session.permission_mode, newId)
  }
  // Link new session back to its parent so chains are reconstructable
  sessionQueries.setCompactedFrom(newId, req.params.id)

  res.status(201).json({ sessionId: newSession.id, summary: summaryTrimmed })
})

router.get('/:id/chain', (req, res) => {
  const session = sessionQueries.findById(req.params.id)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }

  // Walk backward to find the root of the chain
  let root = session
  const visited = new Set<string>()
  while (root.compacted_from && !visited.has(root.compacted_from)) {
    visited.add(root.id)
    const parent = sessionQueries.findById(root.compacted_from)
    if (!parent) break
    root = parent
  }

  // Walk forward from root to get the full ordered chain
  const chain = sessionQueries.getChain(root.id)

  // Extract compact summaries from system_prompt for each non-root segment
  const result = chain.map((s) => {
    const SUMMARY_PREFIX = 'Previous conversation summary:\n'
    const promptAfterSep = s.system_prompt?.includes('\n\n---\n\n')
      ? s.system_prompt.split('\n\n---\n\n').slice(1).join('\n\n---\n\n')
      : s.system_prompt ?? ''
    const compactSummary = promptAfterSep.startsWith(SUMMARY_PREFIX)
      ? promptAfterSep.slice(SUMMARY_PREFIX.length)
      : null
    return { ...s, compactSummary }
  })

  res.json(result)
})

router.delete('/:id', (req, res) => {
  const session = sessionQueries.findById(req.params.id)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }
  scheduleQueries.deleteBySession(req.params.id)
  messageQueries.deleteBySessionId(req.params.id)
  sessionQueries.delete(req.params.id)
  res.status(204).end()
})

export default router
