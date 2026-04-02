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

function cellFilePath(dataDir: string, cellId: string, language: Language): string {
  return path.join(dataDir, 'cells', `${cellId}.${EXT[language]}`)
}

// GET /api/cells
cellsRouter.get('/cells', (req, res) => {
  res.json(listCells())
})

// GET /api/cells/:id
cellsRouter.get('/cells/:id', (req, res) => {
  const cell = getCell(req.params.id)
  if (!cell) { res.status(404).json({ error: 'Cell not found' }); return }
  res.json(cell)
})

// POST /api/cells
cellsRouter.post('/cells', (req, res) => {
  const { type = 'code', language = 'python', position, source = '' } = req.body as {
    type?: CellType
    language?: Language
    position?: number
    source?: string
  }

  const cell = createCell({ type, language, position, source })
  const dataDir = req.app.locals.dataDir as string

  // Write the cell file
  const filePath = cellFilePath(dataDir, cell.id, cell.language)
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

  // Handle language change — rename the file
  if (language && language !== existing.language) {
    const oldPath = cellFilePath(dataDir, existing.id, existing.language)
    const newPath = cellFilePath(dataDir, existing.id, language)
    if (fs.existsSync(oldPath)) {
      markServerWrite(existing.id)
      fs.renameSync(oldPath, newPath)
    }
  }

  // Update source on disk
  if (source !== undefined) {
    const lang = language ?? existing.language
    const filePath = cellFilePath(dataDir, existing.id, lang)
    markServerWrite(existing.id)
    fs.writeFileSync(filePath, source)
    updateCellSource(existing.id, source)
  }

  // Update other fields in DB
  const updated = updateCell(existing.id, { source, language, type })

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
  const filePath = cellFilePath(dataDir, cell.id, cell.language)

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }

  deleteCell(cell.id)
  res.status(204).end()
})
