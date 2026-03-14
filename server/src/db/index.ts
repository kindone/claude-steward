import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DB_PATH = process.env.DATABASE_PATH ?? path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../steward.db'   // server/src/db/ → server/steward.db
)

const db = new DatabaseSync(DB_PATH)

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    path       TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id                TEXT PRIMARY KEY,
    title             TEXT NOT NULL DEFAULT 'New Chat',
    claude_session_id TEXT,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
  )
`)

// Idempotent migrations
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id)`)
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN system_prompt TEXT`)
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'acceptEdits'`)
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE projects ADD COLUMN allow_all_tools INTEGER NOT NULL DEFAULT 0`)
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE projects ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'default'`)
} catch { /* already exists */ }
// Promote any rows that were set to allow_all_tools=1 before permission_mode existed
db.exec(`UPDATE projects SET permission_mode = 'bypassPermissions' WHERE allow_all_tools = 1 AND permission_mode = 'default'`)

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`)

// ── Types ────────────────────────────────────────────────────────────────────

export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

export type Project = {
  id: string
  name: string
  path: string
  allow_all_tools: number       // legacy; superseded by permission_mode
  permission_mode: PermissionMode
  created_at: number
}

export type Session = {
  id: string
  title: string
  claude_session_id: string | null
  project_id: string | null
  system_prompt: string | null
  permission_mode: PermissionMode
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

// ── Project queries ───────────────────────────────────────────────────────────

const createProjectStmt = db.prepare(
  `INSERT INTO projects (id, name, path) VALUES (?, ?, ?) RETURNING *`
)
const listProjectsStmt = db.prepare(`SELECT * FROM projects ORDER BY created_at ASC`)
const findProjectByIdStmt = db.prepare(`SELECT * FROM projects WHERE id = ?`)
const updateAllowAllToolsStmt = db.prepare(
  `UPDATE projects SET allow_all_tools = ? WHERE id = ?`
)
const updatePermissionModeStmt = db.prepare(
  `UPDATE projects SET permission_mode = ? WHERE id = ?`
)
const deleteProjectStmt = db.prepare(`DELETE FROM projects WHERE id = ?`)
const nullifyProjectSessionsStmt = db.prepare(
  `UPDATE sessions SET project_id = NULL WHERE project_id = ?`
)

export const projectQueries = {
  create: (id: string, name: string, path: string) =>
    createProjectStmt.get(id, name, path) as Project,
  list: () => listProjectsStmt.all() as Project[],
  findById: (id: string) => findProjectByIdStmt.get(id) as Project | undefined,
  updateAllowAllTools: (allow: boolean, id: string) =>
    updateAllowAllToolsStmt.run(allow ? 1 : 0, id),
  updatePermissionMode: (mode: PermissionMode, id: string) =>
    updatePermissionModeStmt.run(mode, id),
  delete: (id: string) => {
    nullifyProjectSessionsStmt.run(id)
    deleteProjectStmt.run(id)
  },
}

// ── Session queries ───────────────────────────────────────────────────────────

const createSessionStmt = db.prepare(
  `INSERT INTO sessions (id, title, project_id) VALUES (?, ?, ?) RETURNING *`
)
const findSessionByIdStmt = db.prepare(`SELECT * FROM sessions WHERE id = ?`)
const listAllSessionsStmt = db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`)
const listSessionsByProjectStmt = db.prepare(
  `SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC`
)
const updateClaudeSessionIdStmt = db.prepare(
  `UPDATE sessions SET claude_session_id = ?, updated_at = unixepoch() WHERE id = ?`
)
const updateTitleStmt = db.prepare(
  `UPDATE sessions SET title = ?, updated_at = unixepoch() WHERE id = ?`
)
const updateSystemPromptStmt = db.prepare(
  `UPDATE sessions SET system_prompt = ?, updated_at = unixepoch() WHERE id = ?`
)
const updatePermissionModeSessionStmt = db.prepare(
  `UPDATE sessions SET permission_mode = ?, updated_at = unixepoch() WHERE id = ?`
)
const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE id = ?`)

export const sessionQueries = {
  create: (id: string, title: string, projectId?: string | null) =>
    createSessionStmt.get(id, title, projectId ?? null) as Session,
  findById: (id: string) => findSessionByIdStmt.get(id) as Session | undefined,
  list: () => listAllSessionsStmt.all() as Session[],
  listByProject: (projectId: string) =>
    listSessionsByProjectStmt.all(projectId) as Session[],
  updateClaudeSessionId: (claudeSessionId: string, id: string) =>
    updateClaudeSessionIdStmt.run(claudeSessionId, id),
  clearClaudeSessionId: (id: string) =>
    updateClaudeSessionIdStmt.run(null, id),
  updateTitle: (title: string, id: string) => updateTitleStmt.run(title, id),
  updateSystemPrompt: (systemPrompt: string | null, id: string) =>
    updateSystemPromptStmt.run(systemPrompt, id),
  updatePermissionMode: (mode: PermissionMode, id: string) =>
    updatePermissionModeSessionStmt.run(mode, id),
  delete: (id: string) => deleteSessionStmt.run(id),
}

// ── Message queries ───────────────────────────────────────────────────────────

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

/**
 * Assign any sessions with no project to the project whose path matches appRoot.
 * Call once on startup after removing the "no project" session option.
 */
export function migrateOrphanedSessions(appRoot: string): void {
  const steward = db.prepare(`SELECT id FROM projects WHERE path = ?`).get(appRoot) as { id: string } | undefined
  if (!steward) return
  const result = db.prepare(`UPDATE sessions SET project_id = ? WHERE project_id IS NULL`).run(steward.id)
  if (result.changes > 0) {
    console.log(`[db] migrated ${result.changes} orphaned session(s) to project ${steward.id}`)
  }
}

export default db
