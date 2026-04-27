import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'

export type Language = 'python' | 'node' | 'bash' | 'cpp' | 'sql'
export type CellType = 'code' | 'markdown'

export interface Notebook {
  id: string
  title: string
  claude_session_id: string | null  // legacy; kept for migrations
  created_at: number
  updated_at: number
}

export interface Cell {
  id: string
  notebook_id: string
  type: CellType
  language: Language
  position: number
  name: string | null
  source: string
  created_at: number
  updated_at: number
}

export interface ChatSession {
  id: string
  notebook_id: string
  claude_session_id: string | null
  title: string
  system_prompt: string | null
  compact_timestamps: string | null  // JSON array of unix timestamps
  created_at: number
  updated_at: number
}

export interface ChatMessage {
  id: string
  notebook_id: string
  chat_session_id: string | null
  role: 'user' | 'assistant'
  content: string
  tool_calls: string | null  // JSON-encoded ToolCall[]
  is_error: number           // 0 | 1
  created_at: number
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

  _db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id                TEXT PRIMARY KEY,
      notebook_id       TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      claude_session_id TEXT,
      title             TEXT NOT NULL DEFAULT 'New chat',
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  _db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id               TEXT PRIMARY KEY,
      notebook_id      TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      chat_session_id  TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role             TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content          TEXT NOT NULL DEFAULT '',
      tool_calls       TEXT,
      is_error         INTEGER NOT NULL DEFAULT 0,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  // Legacy table — kept so old data isn't lost on first upgrade
  _db.exec(`
    CREATE TABLE IF NOT EXISTS notebook_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // ── Migrations ─────────────────────────────────────────────────────────────

  // v1: add notebook_id column to cells if upgrading from single-notebook schema
  const cellCols = (_db.prepare('PRAGMA table_info(cells)').all() as { name: string }[]).map(r => r.name)
  if (!cellCols.includes('notebook_id')) {
    _db.exec('ALTER TABLE cells ADD COLUMN notebook_id TEXT REFERENCES notebooks(id) ON DELETE CASCADE')
  }

  // v2: add chat_session_id to chat_messages if upgrading from pre-session schema
  const msgCols = (_db.prepare('PRAGMA table_info(chat_messages)').all() as { name: string }[]).map(r => r.name)
  if (!msgCols.includes('chat_session_id')) {
    _db.exec('ALTER TABLE chat_messages ADD COLUMN chat_session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE')
  }

  // v4: add name column to cells
  if (!cellCols.includes('name')) {
    _db.exec('ALTER TABLE cells ADD COLUMN name TEXT')
  }

  // v5: add system_prompt column to chat_sessions (for compaction)
  const sessionCols = (_db.prepare('PRAGMA table_info(chat_sessions)').all() as { name: string }[]).map(r => r.name)
  if (!sessionCols.includes('system_prompt')) {
    _db.exec('ALTER TABLE chat_sessions ADD COLUMN system_prompt TEXT')
  }

  // v6: add compact_timestamps column to chat_sessions (JSON array of unix timestamps)
  if (!sessionCols.includes('compact_timestamps')) {
    _db.exec('ALTER TABLE chat_sessions ADD COLUMN compact_timestamps TEXT')
  }

  // v2 migration: assign orphaned cells to a default notebook
  const orphanCount = (_db.prepare('SELECT COUNT(*) AS n FROM cells WHERE notebook_id IS NULL').get() as { n: number }).n
  if (orphanCount > 0) {
    const defaultId = crypto.randomUUID()
    _db.prepare('INSERT INTO notebooks (id, title) VALUES (?, ?)').run(defaultId, 'Default')
    _db.prepare('UPDATE cells SET notebook_id = ? WHERE notebook_id IS NULL').run(defaultId)
    console.log(`[db] migrated ${orphanCount} cell(s) → notebook ${defaultId}`)
    return { defaultNotebookId: defaultId }
  }

  // v3 migration: for each notebook with a legacy claude_session_id and orphaned messages,
  // create a chat_session and assign those messages to it.
  const legacyNbs = _db.prepare(
    `SELECT id, claude_session_id FROM notebooks WHERE claude_session_id IS NOT NULL`
  ).all() as { id: string; claude_session_id: string }[]

  for (const nb of legacyNbs) {
    const orphanMsgs = (_db.prepare(
      'SELECT COUNT(*) AS n FROM chat_messages WHERE notebook_id = ? AND chat_session_id IS NULL'
    ).get(nb.id) as { n: number }).n

    if (orphanMsgs > 0) {
      const sesId = crypto.randomUUID()
      _db.prepare(`
        INSERT INTO chat_sessions (id, notebook_id, claude_session_id, title)
        VALUES (?, ?, ?, 'Imported session')
      `).run(sesId, nb.id, nb.claude_session_id)
      _db.prepare(
        'UPDATE chat_messages SET chat_session_id = ? WHERE notebook_id = ? AND chat_session_id IS NULL'
      ).run(sesId, nb.id)
      console.log(`[db] migrated ${orphanMsgs} message(s) from notebook ${nb.id} → session ${sesId}`)
    }
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
  opts: { type?: CellType; language?: Language; position?: number; source?: string; name?: string },
): Cell {
  const id = crypto.randomUUID()
  const type = opts.type ?? 'code'
  const language = opts.language ?? 'python'
  const source = opts.source ?? ''
  const name = opts.name ?? null

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
    INSERT INTO cells (id, notebook_id, type, language, position, source, name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, notebookId, type, language, position, source, name)

  return getCell(id)!
}

export function updateCell(id: string, updates: { source?: string; language?: Language; type?: CellType; name?: string | null }): Cell | null {
  const cell = getCell(id)
  if (!cell) return null

  const source = updates.source ?? cell.source
  const language = updates.language ?? cell.language
  const type = updates.type ?? cell.type
  const name = 'name' in updates ? (updates.name ?? null) : cell.name

  db().prepare(`
    UPDATE cells SET source = ?, language = ?, type = ?, name = ?, updated_at = unixepoch()
    WHERE id = ?
  `).run(source, language, type, name, id)

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

// ── Chat session queries ──────────────────────────────────────────────────────

export function listChatSessions(notebookId: string): ChatSession[] {
  return db().prepare(
    'SELECT * FROM chat_sessions WHERE notebook_id = ? ORDER BY created_at ASC'
  ).all(notebookId) as unknown as ChatSession[]
}

export function getChatSession(id: string): ChatSession | null {
  return (db().prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as unknown as ChatSession) ?? null
}

export function createChatSession(notebookId: string, title = 'New chat'): ChatSession {
  const id = crypto.randomUUID()
  db().prepare('INSERT INTO chat_sessions (id, notebook_id, title) VALUES (?, ?, ?)').run(id, notebookId, title)
  return getChatSession(id)!
}

export function updateChatSession(id: string, updates: { claude_session_id?: string | null; title?: string; system_prompt?: string | null; compact_timestamps?: string | null }): void {
  const session = getChatSession(id)
  if (!session) return
  const claudeId = 'claude_session_id' in updates ? (updates.claude_session_id ?? null) : session.claude_session_id
  const title = updates.title ?? session.title
  const systemPrompt = 'system_prompt' in updates ? (updates.system_prompt ?? null) : session.system_prompt
  const compactTs = 'compact_timestamps' in updates ? (updates.compact_timestamps ?? null) : session.compact_timestamps
  db().prepare(
    'UPDATE chat_sessions SET claude_session_id = ?, title = ?, system_prompt = ?, compact_timestamps = ?, updated_at = unixepoch() WHERE id = ?'
  ).run(claudeId, title, systemPrompt, compactTs, id)
}

export function deleteChatSession(id: string): void {
  // ON DELETE CASCADE removes associated messages
  db().prepare('DELETE FROM chat_sessions WHERE id = ?').run(id)
}

export function clearChatMessages(sessionId: string): void {
  db().prepare('DELETE FROM chat_messages WHERE chat_session_id = ?').run(sessionId)
}

// ── Chat message queries ──────────────────────────────────────────────────────

export function listChatMessages(sessionId: string): ChatMessage[] {
  return db().prepare(
    'SELECT * FROM chat_messages WHERE chat_session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as unknown as ChatMessage[]
}

export function saveChatMessage(
  notebookId: string,
  sessionId: string,
  opts: { role: 'user' | 'assistant'; content: string; toolCalls?: unknown[]; isError?: boolean },
): ChatMessage {
  const id = crypto.randomUUID()
  db().prepare(`
    INSERT INTO chat_messages (id, notebook_id, chat_session_id, role, content, tool_calls, is_error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    notebookId,
    sessionId,
    opts.role,
    opts.content,
    opts.toolCalls && opts.toolCalls.length > 0 ? JSON.stringify(opts.toolCalls) : null,
    opts.isError ? 1 : 0,
  )
  return db().prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as unknown as ChatMessage
}
