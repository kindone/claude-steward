import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DB_PATH = process.env.DATABASE_PATH ?? path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../steward.db'   // server/src/db/ → server/steward.db
)

const db = new DatabaseSync(DB_PATH)

db.exec('PRAGMA journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id                TEXT PRIMARY KEY,
    title             TEXT NOT NULL DEFAULT 'New Chat',
    claude_session_id TEXT,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`)

export type Session = {
  id: string
  title: string
  claude_session_id: string | null
  created_at: number
  updated_at: number
}

export type Message = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: number
}

const createStmt = db.prepare(
  `INSERT INTO sessions (id, title) VALUES (?, ?) RETURNING *`
)
const findByIdStmt = db.prepare(`SELECT * FROM sessions WHERE id = ?`)
const listStmt = db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`)
const updateClaudeSessionIdStmt = db.prepare(
  `UPDATE sessions SET claude_session_id = ?, updated_at = unixepoch() WHERE id = ?`
)
const updateTitleStmt = db.prepare(
  `UPDATE sessions SET title = ?, updated_at = unixepoch() WHERE id = ?`
)

const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE id = ?`)

export const sessionQueries = {
  create: (id: string, title: string) => createStmt.get(id, title) as Session,
  findById: (id: string) => findByIdStmt.get(id) as Session | undefined,
  list: () => listStmt.all() as Session[],
  updateClaudeSessionId: (claudeSessionId: string, id: string) =>
    updateClaudeSessionIdStmt.run(claudeSessionId, id),
  updateTitle: (title: string, id: string) => updateTitleStmt.run(title, id),
  delete: (id: string) => deleteSessionStmt.run(id),
}

const insertMessageStmt = db.prepare(
  `INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)`
)
const listMessagesBySessionStmt = db.prepare(
  `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`
)
const deleteMessagesBySessionStmt = db.prepare(
  `DELETE FROM messages WHERE session_id = ?`
)

export const messageQueries = {
  insert: (id: string, sessionId: string, role: 'user' | 'assistant', content: string) =>
    insertMessageStmt.run(id, sessionId, role, content),
  listBySessionId: (sessionId: string) =>
    listMessagesBySessionStmt.all(sessionId) as Message[],
  deleteBySessionId: (sessionId: string) =>
    deleteMessagesBySessionStmt.run(sessionId),
}

export default db
