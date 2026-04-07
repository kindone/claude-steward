import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'

export type Language = 'python' | 'node' | 'bash' | 'cpp'
export type CellType = 'code' | 'markdown'

export interface Notebook {
  id: string
  title: string
  claude_session_id: string | null
  created_at: number
  updated_at: number
}

export interface Cell {
  id: string
  notebook_id: string
  type: CellType
  language: Language
  position: number
  source: string
  created_at: number
  updated_at: number
}

let _db: DatabaseSync | null = null

export function initDb(dbPath: string): { defaultNotebookId?: string } {
  _db = new DatabaseSync(dbPath)
  _db.exec('PRAGMA journal_mode = WAL')
  _db.exec('PRAGMA foreign_keys = ON')

  _db.exec(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL DEFAULT 'Untitled',
      claude_session_id TEXT,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  _db.exec(`
    CREATE TABLE IF NOT EXISTS cells (
      id          TEXT PRIMARY KEY,
      notebook_id TEXT REFERENCES notebooks(id) ON DELETE CASCADE,
      type        TEXT NOT NULL DEFAULT 'code',
      language    TEXT NOT NULL DEFAULT 'python',
      position    INTEGER NOT NULL,
      source      TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  // Legacy table — kept so old data isn't lost on first upgrade
  _db.exec(`
    CREATE TABLE IF NOT EXISTS notebook_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // Migration: add notebook_id column if upgrading from single-notebook schema
  const cellCols = (_db.prepare('PRAGMA table_info(cells)').all() as { name: string }[]).map(r => r.name)
  if (!cellCols.includes('notebook_id')) {
    _db.exec('ALTER TABLE cells ADD COLUMN notebook_id TEXT REFERENCES notebooks(id) ON DELETE CASCADE')
  }

  // Migration: assign orphaned cells to a default notebook
  const orphanCount = (_db.prepare('SELECT COUNT(*) AS n FROM cells WHERE notebook_id IS NULL').get() as { n: number }).n
  if (orphanCount > 0) {
    const defaultId = crypto.randomUUID()
    _db.prepare('INSERT INTO notebooks (id, title) VALUES (?, ?)').run(defaultId, 'Default')
    _db.prepare('UPDATE cells SET notebook_id = ? WHERE notebook_id IS NULL').run(defaultId)
    console.log(`[db] migrated ${orphanCount} cell(s) → notebook ${defaultId}`)
    return { defaultNotebookId: defaultId }
  }

  return {}
}

function db(): DatabaseSync {
  if (!_db) throw new Error('DB not initialized — call initDb() first')
  return _db
}

// ── Notebook queries ──────────────────────────────────────────────────────────

export function listNotebooks(): Notebook[] {
  return db().prepare('SELECT * FROM notebooks ORDER BY created_at ASC').all() as unknown as Notebook[]
}

export function getNotebook(id: string): Notebook | null {
  return (db().prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as unknown as Notebook) ?? null
}

export function createNotebook(title: string): Notebook {
  const id = crypto.randomUUID()
  db().prepare('INSERT INTO notebooks (id, title) VALUES (?, ?)').run(id, title)
  return getNotebook(id)!
}

export function updateNotebook(id: string, updates: { title?: string; claude_session_id?: string | null }): Notebook | null {
  const nb = getNotebook(id)
  if (!nb) return null

  const title = updates.title ?? nb.title
  const sessionId = 'claude_session_id' in updates ? (updates.claude_session_id ?? null) : nb.claude_session_id

  db().prepare(`
    UPDATE notebooks SET title = ?, claude_session_id = ?, updated_at = unixepoch()
    WHERE id = ?
  `).run(title, sessionId, id)

  return getNotebook(id)!
}

export function deleteNotebook(id: string): boolean {
  const nb = getNotebook(id)
  if (!nb) return false
  // ON DELETE CASCADE removes all cells
  db().prepare('DELETE FROM notebooks WHERE id = ?').run(id)
  return true
}

// ── Cell queries ──────────────────────────────────────────────────────────────

export function listCells(notebookId: string): Cell[] {
  return db().prepare(
    'SELECT * FROM cells WHERE notebook_id = ? ORDER BY position ASC'
  ).all(notebookId) as unknown as Cell[]
}

export function getCell(id: string): Cell | null {
  return (db().prepare('SELECT * FROM cells WHERE id = ?').get(id) as unknown as Cell) ?? null
}

export function createCell(
  notebookId: string,
  opts: { type?: CellType; language?: Language; position?: number; source?: string },
): Cell {
  const id = crypto.randomUUID()
  const type = opts.type ?? 'code'
  const language = opts.language ?? 'python'
  const source = opts.source ?? ''

  const position = opts.position ?? (() => {
    const row = db().prepare(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next FROM cells WHERE notebook_id = ?'
    ).get(notebookId) as { next: number }
    return row.next
  })()

  if (opts.position !== undefined) {
    db().prepare(
      'UPDATE cells SET position = position + 1 WHERE notebook_id = ? AND position >= ?'
    ).run(notebookId, position)
  }

  db().prepare(`
    INSERT INTO cells (id, notebook_id, type, language, position, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, notebookId, type, language, position, source)

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
    db().prepare(
      'UPDATE cells SET position = position - 1 WHERE notebook_id = ? AND position > ? AND position <= ?'
    ).run(cell.notebook_id, oldPosition, newPosition)
  } else {
    db().prepare(
      'UPDATE cells SET position = position + 1 WHERE notebook_id = ? AND position >= ? AND position < ?'
    ).run(cell.notebook_id, newPosition, oldPosition)
  }

  db().prepare('UPDATE cells SET position = ?, updated_at = unixepoch() WHERE id = ?')
    .run(newPosition, id)

  return getCell(id)!
}

export function deleteCell(id: string): boolean {
  const cell = getCell(id)
  if (!cell) return false

  db().prepare('DELETE FROM cells WHERE id = ?').run(id)
  db().prepare(
    'UPDATE cells SET position = position - 1 WHERE notebook_id = ? AND position > ?'
  ).run(cell.notebook_id, cell.position)

  return true
}
