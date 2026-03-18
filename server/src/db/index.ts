import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const DB_PATH = process.env.DATABASE_PATH ?? path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../steward.db'   // server/src/db/ → server/steward.db
)

// Ensure the parent directory exists before opening. Gives a clear error
// instead of a cryptic ERR_SQLITE_ERROR when DATABASE_PATH points somewhere invalid.
const DB_DIR = path.dirname(DB_PATH)
if (!fs.existsSync(DB_DIR)) {
  console.error(`[db] ERROR: database directory does not exist: ${DB_DIR}`)
  console.error(`[db]   DATABASE_PATH=${DB_PATH}`)
  console.error(`[db]   Fix: create the directory, or correct DATABASE_PATH in your ecosystem config / .env`)
  process.exit(1)
}

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
try {
  db.exec(`ALTER TABLE messages ADD COLUMN is_error INTEGER NOT NULL DEFAULT 0`)
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE messages ADD COLUMN error_code TEXT`)
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'complete'`)
} catch { /* already exists */ }
// On boot: any message left 'streaming' means the server was killed mid-run — mark interrupted.
db.exec(`UPDATE messages SET status = 'interrupted' WHERE status = 'streaming'`)

db.exec(`
  CREATE TABLE IF NOT EXISTS passkey_credentials (
    id           TEXT PRIMARY KEY,
    public_key   BLOB NOT NULL,
    counter      INTEGER NOT NULL,
    transports   TEXT,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    last_used_at INTEGER
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS auth_sessions (
    id           TEXT PRIMARY KEY,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at   INTEGER NOT NULL,
    last_seen_at INTEGER
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         TEXT PRIMARY KEY,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
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
  is_error: number        // 0 = normal, 1 = error message
  error_code: string | null
  status: 'complete' | 'streaming' | 'interrupted'
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
  `INSERT INTO messages (id, session_id, role, content, is_error, error_code, status) VALUES (?, ?, ?, ?, ?, ?, ?)`
)
const insertStreamingMessageStmt = db.prepare(
  `INSERT INTO messages (id, session_id, role, content, is_error, error_code, status) VALUES (?, ?, 'assistant', '', 0, NULL, 'streaming')`
)
const updateStreamingContentStmt = db.prepare(
  `UPDATE messages SET content = ? WHERE id = ? AND status = 'streaming'`
)
const finalizeMessageStmt = db.prepare(
  `UPDATE messages SET content = ?, status = ?, is_error = ?, error_code = ? WHERE id = ?`
)
const listMessagesBySessionStmt = db.prepare(
  `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`
)
// Fetch the N most recent messages (newest-first); caller should reverse for display.
const listPagedDescStmt = db.prepare(
  `SELECT * FROM messages WHERE session_id = ? ORDER BY rowid DESC LIMIT ?`
)
// Fetch N messages older than the message with the given id (newest-first within that slice).
const listBeforeDescStmt = db.prepare(
  `SELECT m.* FROM messages m
   WHERE m.session_id = ?
     AND m.rowid < (SELECT rowid FROM messages WHERE id = ?)
   ORDER BY m.rowid DESC LIMIT ?`
)
const deleteMessagesBySessionStmt = db.prepare(
  `DELETE FROM messages WHERE session_id = ?`
)

export const messageQueries = {
  insert: (id: string, sessionId: string, role: 'user' | 'assistant', content: string, isError = false, errorCode?: string) =>
    insertMessageStmt.run(id, sessionId, role, content, isError ? 1 : 0, errorCode ?? null, 'complete'),
  /** Insert an empty assistant message that will be filled in as streaming progresses. */
  insertStreaming: (id: string, sessionId: string) =>
    insertStreamingMessageStmt.run(id, sessionId),
  /** Flush partial content to DB during streaming (safe no-op if already finalized). */
  updateStreamingContent: (id: string, content: string) =>
    updateStreamingContentStmt.run(content, id),
  /** Finalize a streaming message on completion or error. */
  finalizeMessage: (id: string, content: string, isError: boolean, errorCode?: string) =>
    finalizeMessageStmt.run(content, 'complete', isError ? 1 : 0, errorCode ?? null, id),
  listBySessionId: (sessionId: string) =>
    listMessagesBySessionStmt.all(sessionId) as Message[],
  /**
   * Returns up to `limit` messages in ascending (display) order.
   * If `beforeId` is given, only messages older than that message are returned.
   * The extra +1 fetch trick: pass `limit + 1` to detect whether more pages exist.
   */
  listPaged: (sessionId: string, limit: number, beforeId?: string): Message[] => {
    const rows = beforeId
      ? (listBeforeDescStmt.all(sessionId, beforeId, limit) as Message[])
      : (listPagedDescStmt.all(sessionId, limit) as Message[])
    return rows.reverse()
  },
  deleteBySessionId: (sessionId: string) =>
    deleteMessagesBySessionStmt.run(sessionId),
}

// ── Auth types ────────────────────────────────────────────────────────────────

export type PasskeyCredential = {
  id: string
  public_key: Buffer
  counter: number
  transports: string | null
  created_at: number
  last_used_at: number | null
}

export type AuthSession = {
  id: string
  created_at: number
  expires_at: number
  last_seen_at: number | null
}

// ── Passkey credential queries ─────────────────────────────────────────────────

const insertCredentialStmt = db.prepare(
  `INSERT INTO passkey_credentials (id, public_key, counter, transports)
   VALUES (?, ?, ?, ?)`
)
const listCredentialsStmt = db.prepare(
  `SELECT * FROM passkey_credentials ORDER BY created_at ASC`
)
const findCredentialByIdStmt = db.prepare(
  `SELECT * FROM passkey_credentials WHERE id = ?`
)
const updateCredentialCounterStmt = db.prepare(
  `UPDATE passkey_credentials SET counter = ?, last_used_at = unixepoch() WHERE id = ?`
)
const deleteCredentialStmt = db.prepare(
  `DELETE FROM passkey_credentials WHERE id = ?`
)

export const credentialQueries = {
  insert: (id: string, publicKey: Buffer, counter: number, transports: string | null) =>
    insertCredentialStmt.run(id, publicKey, counter, transports),
  list: () => listCredentialsStmt.all() as PasskeyCredential[],
  findById: (id: string) => findCredentialByIdStmt.get(id) as PasskeyCredential | undefined,
  updateCounter: (id: string, counter: number) =>
    updateCredentialCounterStmt.run(counter, id),
  delete: (id: string) => deleteCredentialStmt.run(id),
}

// ── Auth session queries ────────────────────────────────────────────────────────

const SESSION_TTL_DAYS = 30

const insertAuthSessionStmt = db.prepare(
  `INSERT INTO auth_sessions (id, expires_at) VALUES (?, unixepoch() + ?)
   RETURNING *`
)
const findAuthSessionStmt = db.prepare(
  `SELECT * FROM auth_sessions WHERE id = ? AND expires_at > unixepoch()`
)
const touchAuthSessionStmt = db.prepare(
  `UPDATE auth_sessions SET last_seen_at = unixepoch() WHERE id = ?`
)
const deleteAuthSessionStmt = db.prepare(
  `DELETE FROM auth_sessions WHERE id = ?`
)
const purgeExpiredSessionsStmt = db.prepare(
  `DELETE FROM auth_sessions WHERE expires_at <= unixepoch()`
)

export const authSessionQueries = {
  create: (id: string) =>
    insertAuthSessionStmt.get(id, SESSION_TTL_DAYS * 86400) as AuthSession,
  findValid: (id: string) => findAuthSessionStmt.get(id) as AuthSession | undefined,
  touch: (id: string) => touchAuthSessionStmt.run(id),
  delete: (id: string) => deleteAuthSessionStmt.run(id),
  purgeExpired: () => purgeExpiredSessionsStmt.run(),
}

// ── Push subscription types & queries ────────────────────────────────────────

export type PushSubscription = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: number
}

const insertPushSubStmt = db.prepare(
  `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
   ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth`
)
const listPushSubsStmt = db.prepare(`SELECT * FROM push_subscriptions`)
const deletePushSubByEndpointStmt = db.prepare(
  `DELETE FROM push_subscriptions WHERE endpoint = ?`
)
const deletePushSubByIdStmt = db.prepare(
  `DELETE FROM push_subscriptions WHERE id = ?`
)

export const pushSubscriptionQueries = {
  upsert: (id: string, endpoint: string, p256dh: string, auth: string) =>
    insertPushSubStmt.run(id, endpoint, p256dh, auth),
  list: () => listPushSubsStmt.all() as PushSubscription[],
  deleteByEndpoint: (endpoint: string) => deletePushSubByEndpointStmt.run(endpoint),
  deleteById: (id: string) => deletePushSubByIdStmt.run(id),
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
