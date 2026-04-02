import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'

export type Language = 'python' | 'node' | 'bash' | 'cpp'
export type CellType = 'code' | 'markdown'

export interface Cell {
  id: string
  type: CellType
  language: Language
  position: number
  source: string
  created_at: number
  updated_at: number
}

export interface NotebookMeta {
  key: string
  value: string
}

let _db: DatabaseSync | null = null

export function initDb(dbPath: string): void {
  _db = new DatabaseSync(dbPath)
  _db.exec('PRAGMA journal_mode = WAL')
  _db.exec('PRAGMA foreign_keys = ON')

  _db.exec(`
    CREATE TABLE IF NOT EXISTS cells (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL DEFAULT 'code',
      language    TEXT NOT NULL DEFAULT 'python',
      position    INTEGER NOT NULL,
      source      TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  _db.exec(`
    CREATE TABLE IF NOT EXISTS notebook_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
}

function db(): DatabaseSync {
  if (!_db) throw new Error('DB not initialized — call initDb() first')
  return _db
}

// ── Cell queries ──────────────────────────────────────────────────────────────

export function listCells(): Cell[] {
  return db().prepare('SELECT * FROM cells ORDER BY position ASC').all() as unknown as Cell[]
}

export function getCell(id: string): Cell | null {
  return (db().prepare('SELECT * FROM cells WHERE id = ?').get(id) as unknown as Cell) ?? null
}

export function createCell(opts: { type?: CellType; language?: Language; position?: number; source?: string }): Cell {
  const id = crypto.randomUUID()
  const type = opts.type ?? 'code'
  const language = opts.language ?? 'python'
  const source = opts.source ?? ''

  // Default position: after the last cell
  const position = opts.position ?? (() => {
    const row = db().prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM cells').get() as { next: number }
    return row.next
  })()

  // Shift cells down to make room if inserting at a specific position
  if (opts.position !== undefined) {
    db().prepare('UPDATE cells SET position = position + 1 WHERE position >= ?').run(position)
  }

  db().prepare(`
    INSERT INTO cells (id, type, language, position, source)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, type, language, position, source)

  return getCell(id)!
}

export function updateCell(id: string, updates: { source?: string; language?: Language; type?: CellType }): Cell | null {
  const cell = getCell(id)
  if (!cell) return null

  const source = updates.source ?? cell.source
  const language = updates.language ?? cell.language
  const type = updates.type ?? cell.type

  db().prepare(`
    UPDATE cells SET source = ?, language = ?, type = ?, updated_at = unixepoch()
    WHERE id = ?
  `).run(source, language, type, id)

  return getCell(id)!
}

export function updateCellSource(id: string, source: string): void {
  db().prepare('UPDATE cells SET source = ?, updated_at = unixepoch() WHERE id = ?').run(source, id)
}

export function moveCell(id: string, newPosition: number): Cell | null {
  const cell = getCell(id)
  if (!cell) return null

  const oldPosition = cell.position

  if (oldPosition === newPosition) return cell

  if (oldPosition < newPosition) {
    // Moving down: shift cells between old+1 and new up by 1
    db().prepare('UPDATE cells SET position = position - 1 WHERE position > ? AND position <= ?')
      .run(oldPosition, newPosition)
  } else {
    // Moving up: shift cells between new and old-1 down by 1
    db().prepare('UPDATE cells SET position = position + 1 WHERE position >= ? AND position < ?')
      .run(newPosition, oldPosition)
  }

  db().prepare('UPDATE cells SET position = ?, updated_at = unixepoch() WHERE id = ?')
    .run(newPosition, id)

  return getCell(id)!
}

export function deleteCell(id: string): boolean {
  const cell = getCell(id)
  if (!cell) return false

  db().prepare('DELETE FROM cells WHERE id = ?').run(id)
  // Close the gap
  db().prepare('UPDATE cells SET position = position - 1 WHERE position > ?').run(cell.position)

  return true
}

// ── Meta queries ──────────────────────────────────────────────────────────────

export function getMeta(key: string): string | null {
  const row = db().prepare('SELECT value FROM notebook_meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(key: string, value: string): void {
  db().prepare('INSERT OR REPLACE INTO notebook_meta (key, value) VALUES (?, ?)').run(key, value)
}

export function deleteMeta(key: string): void {
  db().prepare('DELETE FROM notebook_meta WHERE key = ?').run(key)
}
