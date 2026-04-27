import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { listNotebooks, getNotebook, createNotebook, updateNotebook, deleteNotebook } from '../db.js'
import { getKernelManager } from '../kernels/manager.js'

export const notebooksRouter = Router()

// GET /api/notebooks
notebooksRouter.get('/notebooks', (_req, res) => {
  res.json(listNotebooks())
})

// POST /api/notebooks
notebooksRouter.post('/notebooks', (req, res) => {
  const { title } = req.body as { title?: string }
  if (!title?.trim()) { res.status(400).json({ error: 'title required' }); return }

  const nb = createNotebook(title.trim())

  // Create notebook directory structure
  const dataDir = req.app.locals.dataDir as string
  fs.mkdirSync(path.join(dataDir, 'notebooks', nb.id, 'cells'), { recursive: true })

  res.status(201).json(nb)
})

// PATCH /api/notebooks/:id
notebooksRouter.patch('/notebooks/:id', (req, res) => {
  const { title } = req.body as { title?: string }
  if (!title?.trim()) { res.status(400).json({ error: 'title required' }); return }

  const nb = updateNotebook(req.params.id, { title: title.trim() })
  if (!nb) { res.status(404).json({ error: 'Notebook not found' }); return }
  res.json(nb)
})

// DELETE /api/notebooks/:id
notebooksRouter.delete('/notebooks/:id', (req, res) => {
  const nb = getNotebook(req.params.id)
  if (!nb) { res.status(404).json({ error: 'Notebook not found' }); return }

  // Kill all kernels for this notebook
  try { getKernelManager().killNotebook(req.params.id) } catch { /* not initialised */ }

  // Remove notebook directory
  const dataDir = req.app.locals.dataDir as string
  const nbDir = path.join(dataDir, 'notebooks', req.params.id)
  if (fs.existsSync(nbDir)) fs.rmSync(nbDir, { recursive: true, force: true })

  deleteNotebook(req.params.id)
  res.status(204).end()
})

// POST /api/notebooks/:id/kernel/kill  — called when a tab is closed
notebooksRouter.post('/notebooks/:id/kernel/kill', (req, res) => {
  try { getKernelManager().killNotebook(req.params.id) } catch { /* not initialised */ }
  res.json({ ok: true })
})
