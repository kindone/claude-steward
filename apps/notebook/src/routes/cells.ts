import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import {
  listCells, getCell, createCell, updateCell, moveCell, deleteCell, updateCellSource,
  type Language, type CellType,
} from '../db.js'
import { markServerWrite } from '../watcher.js'

export const cellsRouter = Router()

const EXT: Record<Language, string> = {
  python: 'py',
  node: 'js',
  bash: 'sh',
  cpp: 'cpp',
}

function cellFilePath(dataDir: string, notebookId: string, cellId: string, language: Language): string {
  return path.join(dataDir, 'notebooks', notebookId, 'cells', `${cellId}.${EXT[language]}`)
}

// GET /api/notebooks/:notebookId/cells
cellsRouter.get('/notebooks/:notebookId/cells', (req, res) => {
  res.json(listCells(req.params.notebookId))
})

// POST /api/notebooks/:notebookId/cells
cellsRouter.post('/notebooks/:notebookId/cells', (req, res) => {
  const { notebookId } = req.params
  const { type = 'code', language = 'python', position, source = '' } = req.body as {
    type?: CellType
    language?: Language
    position?: number
    source?: string
  }

  const cell = createCell(notebookId, { type, language, position, source })
  const dataDir = req.app.locals.dataDir as string

  const filePath = cellFilePath(dataDir, notebookId, cell.id, cell.language)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  markServerWrite(cell.id)
  fs.writeFileSync(filePath, source)

  res.status(201).json(cell)
})

// PATCH /api/cells/:id
cellsRouter.patch('/cells/:id', (req, res) => {
  const { source, language, type, position } = req.body as {
    source?: string
    language?: Language
    type?: CellType
    position?: number
  }

  const existing = getCell(req.params.id)
  if (!existing) { res.status(404).json({ error: 'Cell not found' }); return }

  const dataDir = req.app.locals.dataDir as string
  const notebookId = existing.notebook_id

  // Handle language change — rename the file
  if (language && language !== existing.language) {
    const oldPath = cellFilePath(dataDir, notebookId, existing.id, existing.language)
    const newPath = cellFilePath(dataDir, notebookId, existing.id, language)
    if (fs.existsSync(oldPath)) {
      markServerWrite(existing.id)
      fs.renameSync(oldPath, newPath)
    }
  }

  // Update source on disk
  if (source !== undefined) {
    const lang = language ?? existing.language
    const filePath = cellFilePath(dataDir, notebookId, existing.id, lang)
    markServerWrite(existing.id)
    fs.writeFileSync(filePath, source)
    updateCellSource(existing.id, source)
  }

  // Update other fields in DB
  updateCell(existing.id, { source, language, type })

  // Handle position change
  if (position !== undefined && position !== existing.position) {
    moveCell(existing.id, position)
  }

  res.json(getCell(req.params.id))
})

// DELETE /api/cells/:id
cellsRouter.delete('/cells/:id', (req, res) => {
  const cell = getCell(req.params.id)
  if (!cell) { res.status(404).json({ error: 'Cell not found' }); return }

  const dataDir = req.app.locals.dataDir as string
  const filePath = cellFilePath(dataDir, cell.notebook_id, cell.id, cell.language)

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }

  deleteCell(cell.id)
  res.status(204).end()
})
