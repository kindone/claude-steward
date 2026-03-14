import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { sessionQueries, messageQueries } from '../db/index.js'

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
  const session = sessionQueries.create(id, 'New Chat', projectId)
  res.status(201).json(session)
})

router.get('/:id/messages', (req, res) => {
  const session = sessionQueries.findById(req.params.id)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }
  res.json(messageQueries.listBySessionId(req.params.id))
})

router.patch('/:id', (req, res) => {
  const session = sessionQueries.findById(req.params.id)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }
  const { title, systemPrompt } = req.body as { title?: string; systemPrompt?: string | null }

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

  res.json(session)
})

router.delete('/:id', (req, res) => {
  const session = sessionQueries.findById(req.params.id)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }
  messageQueries.deleteBySessionId(req.params.id)
  sessionQueries.delete(req.params.id)
  res.status(204).end()
})

export default router
