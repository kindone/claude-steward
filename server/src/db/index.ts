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
try {
  db.exec(`ALTER TABLE projects ADD COLUMN system_prompt TEXT`)
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
try {
  db.exec(`ALTER TABLE messages ADD COLUMN tool_calls TEXT`)
} catch { /* already exists */ }
// NOTE: stale 'streaming' rows are NOT migrated here — recovery.ts handles them after the
// worker reconnects so in-flight jobs can be recovered. Only call markStaleStreamingMessages()
// after recovery completes (or times out).

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
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN timezone TEXT`)
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE messages ADD COLUMN source TEXT`)
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE push_subscriptions ADD COLUMN session_id TEXT REFERENCES sessions(id)`)
} catch { /* already exists */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS schedules (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id),
    cron        TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    once        INTEGER NOT NULL DEFAULT 0,
    last_run_at INTEGER,
    next_run_at INTEGER,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
  )
`)
try {
  db.exec(`ALTER TABLE schedules ADD COLUMN once INTEGER NOT NULL DEFAULT 0`)
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE schedules ADD COLUMN label TEXT NOT NULL DEFAULT ''`)
} catch { /* already exists */ }
// Unique index so re-emitting the same label+session upserts instead of duplicating.
// Non-empty labels only — empty label schedules are always inserted fresh.
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_session_label
           ON schedules(session_id, label) WHERE label != ''`)
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN model TEXT`)
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN compacted_from TEXT REFERENCES sessions(id)`)
} catch { /* already exists */ }
// `cli` records which adapter (claude / opencode) drives a session. Default
// is locked to whatever STEWARD_CLI is set to at first migration time, so
// existing rows on a deployment get marked with that deployment's actual
// adapter — claude-steward gets 'claude', opencode-steward gets 'opencode'.
// After this column exists, every new session row sets `cli` explicitly via
// the create route, so the default never matters again. NOT NULL plus the
// env-driven default makes the post-merge picture unambiguous: every row in
// the merged DB carries its real adapter without env-time fallback.
try {
  const defaultCli = (process.env.STEWARD_CLI === 'opencode') ? 'opencode' : 'claude'
  db.exec(`ALTER TABLE sessions ADD COLUMN cli TEXT NOT NULL DEFAULT '${defaultCli}'`)
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE schedules ADD COLUMN condition TEXT`)
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE schedules ADD COLUMN expires_at INTEGER`)
} catch { /* already exists */ }

// ── Artifact tables ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS artifacts (
    id                   TEXT PRIMARY KEY,
    project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name                 TEXT NOT NULL,
    type                 TEXT NOT NULL,
    path                 TEXT NOT NULL,
    metadata             TEXT,
    created_from_session TEXT REFERENCES sessions(id),
    created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
  )
`)

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_artifacts_project_id ON artifacts(project_id)
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS topics (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`)

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_topics_project_id ON topics(project_id)
`)

try {
  db.exec(`ALTER TABLE artifacts ADD COLUMN topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL`)
} catch { /* already exists */ }

// ── Mini-app tables ───────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS app_configs (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    type             TEXT NOT NULL DEFAULT 'mkdocs',
    command_template TEXT NOT NULL,
    work_dir         TEXT NOT NULL,
    created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS app_slots (
    slot       INTEGER PRIMARY KEY,
    config_id  TEXT REFERENCES app_configs(id) ON DELETE SET NULL,
    status     TEXT NOT NULL DEFAULT 'stopped',
    pid        INTEGER,
    started_at INTEGER,
    error      TEXT
  )
`)

// Pre-seed the 10 fixed slots (idempotent)
db.exec(`
  INSERT OR IGNORE INTO app_slots (slot) VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10)
`)

// ── Types ─────────────────────────────────────────────────────────────────────

export type Schedule = {
  id: string
  session_id: string
  cron: string
  prompt: string
  label: string
  enabled: number
  once: number        // 1 = delete after first fire, 0 = recurring
  condition: string | null  // JSON-encoded ScheduleCondition, null = no condition
  expires_at: number | null // unix seconds, null = no expiry
  last_run_at: number | null
  next_run_at: number | null
  created_at: number
  updated_at: number
}

export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

export type Project = {
  id: string
  name: string
  path: string
  allow_all_tools: number       // legacy; superseded by permission_mode
  permission_mode: PermissionMode
  system_prompt: string | null
  created_at: number
}

/** Which CLI adapter drives a session. NOT NULL in the DB — every row has
 *  an explicit value. See migration in this file for the env-driven default
 *  used at first migration time. */
export type CliName = 'claude' | 'opencode'

export type Session = {
  id: string
  title: string
  claude_session_id: string | null
  project_id: string | null
  system_prompt: string | null
  permission_mode: PermissionMode
  timezone: string | null
  model: string | null
  cli: CliName
  compacted_from: string | null
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
  tool_calls: string | null  // JSON array of ToolCall objects, null if none
  source: string | null      // null = user-initiated, 'scheduler' = agent-initiated scheduled message
  created_at: number
}

export type ArtifactType = 'chart' | 'report' | 'data' | 'code' | 'pikchr' | 'html' | 'mdart'

export interface Artifact {
  id: string
  project_id: string
  name: string
  type: ArtifactType
  path: string
  metadata: string | null
  topic_id: string | null
  created_from_session: string | null
  created_at: number
  updated_at: number
}

export type Topic = {
  id: string
  project_id: string
  name: string
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
const updateProjectSystemPromptStmt = db.prepare(
  `UPDATE projects SET system_prompt = ? WHERE id = ?`
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
  updateSystemPrompt: (systemPrompt: string | null, id: string) =>
    updateProjectSystemPromptStmt.run(systemPrompt, id),
  delete: (id: string) => {
    nullifyProjectSessionsStmt.run(id)
    deleteProjectStmt.run(id)
  },
}

// ── Session queries ───────────────────────────────────────────────────────────

const createSessionStmt = db.prepare(
  `INSERT INTO sessions (id, title, project_id, system_prompt, cli) VALUES (?, ?, ?, ?, ?) RETURNING *`
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
const updateTimezoneStmt = db.prepare(
  `UPDATE sessions SET timezone = ?, updated_at = unixepoch() WHERE id = ?`
)
const updateModelStmt = db.prepare(
  `UPDATE sessions SET model = ?, updated_at = unixepoch() WHERE id = ?`
)
// NOTE: there is intentionally no updateCliStmt. Per the immutable-per-
// session-CLI design, `sessions.cli` is set at INSERT time (see create
// statement above) and never updated. A clone-with-different-CLI feature
// is the planned escape hatch — see TODO.md "Multi-CLI Support".
const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE id = ?`)
const setCompactedFromStmt = db.prepare(
  `UPDATE sessions SET compacted_from = ? WHERE id = ?`
)
// Walk from a root session forward through the chain (root → child → grandchild…).
// Returns all sessions in chronological order.
const getChainStmt = db.prepare(`
  WITH RECURSIVE chain(id, title, system_prompt, permission_mode, model, cli, timezone, compacted_from, created_at, updated_at) AS (
    SELECT id, title, system_prompt, permission_mode, model, cli, timezone, compacted_from, created_at, updated_at
    FROM sessions WHERE id = ?
    UNION ALL
    SELECT s.id, s.title, s.system_prompt, s.permission_mode, s.model, s.cli, s.timezone, s.compacted_from, s.created_at, s.updated_at
    FROM sessions s JOIN chain c ON s.compacted_from = c.id
  )
  SELECT * FROM chain ORDER BY created_at ASC
`)

/** Default CLI for new sessions whose creator didn't pick one explicitly.
 *  Mirrors the migration default; resolved lazily so test envs that mutate
 *  STEWARD_CLI after import time still take effect. */
function defaultSessionCli(): CliName {
  return process.env.STEWARD_CLI === 'opencode' ? 'opencode' : 'claude'
}

export const sessionQueries = {
  create: (id: string, title: string, projectId?: string | null, systemPrompt?: string | null, cli?: CliName) =>
    createSessionStmt.get(id, title, projectId ?? null, systemPrompt ?? null, cli ?? defaultSessionCli()) as Session,
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
  updateTimezone: (timezone: string, id: string) =>
    updateTimezoneStmt.run(timezone, id),
  updateModel: (model: string | null, id: string) =>
    updateModelStmt.run(model, id),
  // NOTE: no `updateCli` here. CLI is immutable per-session by design;
  // see updateCliStmt comment above and TODO.md "Multi-CLI Support".
  setCompactedFrom: (newId: string, fromId: string) =>
    setCompactedFromStmt.run(fromId, newId),
  getChain: (rootId: string) => getChainStmt.all(rootId) as Session[],
  delete: (id: string) => deleteSessionStmt.run(id),
}

// ── Message queries ───────────────────────────────────────────────────────────

const insertMessageStmt = db.prepare(
  `INSERT INTO messages (id, session_id, role, content, is_error, error_code, status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
)
const insertStreamingMessageStmt = db.prepare(
  `INSERT INTO messages (id, session_id, role, content, is_error, error_code, status) VALUES (?, ?, 'assistant', '', 0, NULL, 'streaming')`
)
const updateStreamingContentStmt = db.prepare(
  `UPDATE messages SET content = ? WHERE id = ? AND status = 'streaming'`
)
const finalizeMessageStmt = db.prepare(
  `UPDATE messages SET content = ?, status = ?, is_error = ?, error_code = ?, tool_calls = ?, source = COALESCE(source, ?) WHERE id = ?`
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
const listStreamingStmt = db.prepare(
  `SELECT * FROM messages WHERE status = 'streaming' ORDER BY created_at ASC`
)

/** Mark any remaining 'streaming' rows as interrupted. Call after recovery completes. */
export function markStaleStreamingMessages(): void {
  db.exec(`UPDATE messages SET status = 'interrupted' WHERE status = 'streaming'`)
}

export const messageQueries = {
  insert: (id: string, sessionId: string, role: 'user' | 'assistant', content: string, isError = false, errorCode?: string, source?: string | null) =>
    insertMessageStmt.run(id, sessionId, role, content, isError ? 1 : 0, errorCode ?? null, 'complete', source ?? null),
  /** Insert an empty assistant message that will be filled in as streaming progresses. */
  insertStreaming: (id: string, sessionId: string) =>
    insertStreamingMessageStmt.run(id, sessionId),
  /** Flush partial content to DB during streaming (safe no-op if already finalized). */
  updateStreamingContent: (id: string, content: string) =>
    updateStreamingContentStmt.run(content, id),
  /** Finalize a streaming message on completion or error. */
  finalizeMessage: (id: string, content: string, isError: boolean, errorCode?: string, toolCalls?: string, source?: string | null) =>
    finalizeMessageStmt.run(content, 'complete', isError ? 1 : 0, errorCode ?? null, toolCalls ?? null, source ?? null, id),
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
  /** All messages currently mid-stream (server was restarted before they completed). */
  listStreaming: () =>
    listStreamingStmt.all() as Message[],
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
  session_id: string | null
  created_at: number
}

const insertPushSubStmt = db.prepare(
  `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, session_id) VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, session_id=excluded.session_id`
)
const listPushSubsStmt = db.prepare(`SELECT * FROM push_subscriptions`)
const listPushSubsBySessionStmt = db.prepare(
  `SELECT * FROM push_subscriptions WHERE session_id = ?`
)
const deletePushSubByEndpointStmt = db.prepare(
  `DELETE FROM push_subscriptions WHERE endpoint = ?`
)
const deletePushSubByIdStmt = db.prepare(
  `DELETE FROM push_subscriptions WHERE id = ?`
)

export const pushSubscriptionQueries = {
  upsert: (id: string, endpoint: string, p256dh: string, auth: string, sessionId?: string | null) =>
    insertPushSubStmt.run(id, endpoint, p256dh, auth, sessionId ?? null),
  list: () => listPushSubsStmt.all() as PushSubscription[],
  listBySession: (sessionId: string) => listPushSubsBySessionStmt.all(sessionId) as PushSubscription[],
  deleteByEndpoint: (endpoint: string) => deletePushSubByEndpointStmt.run(endpoint),
  deleteById: (id: string) => deletePushSubByIdStmt.run(id),
}

// ── Schedule queries ──────────────────────────────────────────────────────────

const insertScheduleStmt = db.prepare(
  `INSERT INTO schedules (id, session_id, cron, prompt, label, enabled, once, condition, expires_at, next_run_at)
   VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
   ON CONFLICT(session_id, label) WHERE label != '' DO UPDATE SET
     cron        = excluded.cron,
     prompt      = excluded.prompt,
     once        = excluded.once,
     condition   = excluded.condition,
     expires_at  = excluded.expires_at,
     next_run_at = excluded.next_run_at,
     updated_at  = unixepoch()
   RETURNING *`
)
const listSchedulesStmt = db.prepare(`SELECT * FROM schedules ORDER BY created_at ASC`)
const listSchedulesBySessionStmt = db.prepare(
  `SELECT * FROM schedules WHERE session_id = ? ORDER BY created_at ASC`
)
const findScheduleByIdStmt = db.prepare(`SELECT * FROM schedules WHERE id = ?`)
const findScheduleBySessionAndLabelStmt = db.prepare(
  `SELECT * FROM schedules WHERE session_id = ? AND label = ? AND label != '' LIMIT 1`
)
const listDueSchedulesStmt = db.prepare(
  `SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
   AND (expires_at IS NULL OR expires_at > ?)`
)
const updateScheduleStmt = db.prepare(
  `UPDATE schedules SET cron = COALESCE(?, cron), prompt = COALESCE(?, prompt),
   enabled = COALESCE(?, enabled), condition = COALESCE(?, condition),
   expires_at = COALESCE(?, expires_at), next_run_at = COALESCE(?, next_run_at),
   updated_at = unixepoch() WHERE id = ? RETURNING *`
)
const markScheduleRanStmt = db.prepare(
  `UPDATE schedules SET last_run_at = ?, next_run_at = ?, updated_at = unixepoch() WHERE id = ?`
)
const deleteScheduleStmt = db.prepare(`DELETE FROM schedules WHERE id = ?`)
const deleteSchedulesBySessionStmt = db.prepare(`DELETE FROM schedules WHERE session_id = ?`)
const findScheduleByLabelStmt = db.prepare(
  `SELECT * FROM schedules WHERE label = ? AND label != '' LIMIT 1`
)

export const scheduleQueries = {
  create: (id: string, sessionId: string, cron: string, prompt: string, nextRunAt: number | null, once = false, label = '', condition: string | null = null, expiresAt: number | null = null) =>
    insertScheduleStmt.get(id, sessionId, cron, prompt, label, once ? 1 : 0, condition, expiresAt, nextRunAt) as Schedule,
  list: () => listSchedulesStmt.all() as Schedule[],
  listBySession: (sessionId: string) => listSchedulesBySessionStmt.all(sessionId) as Schedule[],
  findById: (id: string) => findScheduleByIdStmt.get(id) as Schedule | undefined,
  findBySessionAndLabel: (sessionId: string, label: string) =>
    findScheduleBySessionAndLabelStmt.get(sessionId, label) as Schedule | undefined,
  findByLabel: (label: string) =>
    findScheduleByLabelStmt.get(label) as Schedule | undefined,
  listDue: (now: number) => listDueSchedulesStmt.all(now, now) as Schedule[],
  update: (id: string, patch: { cron?: string; prompt?: string; enabled?: boolean; nextRunAt?: number | null; condition?: string | null; expiresAt?: number | null }) =>
    updateScheduleStmt.get(
      patch.cron ?? null, patch.prompt ?? null,
      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : null,
      patch.condition !== undefined ? patch.condition : null,
      patch.expiresAt !== undefined ? patch.expiresAt : null,
      patch.nextRunAt !== undefined ? patch.nextRunAt : null,
      id
    ) as Schedule,
  markRan: (id: string, ranAt: number, nextRunAt: number | null) =>
    markScheduleRanStmt.run(ranAt, nextRunAt, id),
  delete: (id: string) => deleteScheduleStmt.run(id),
  deleteBySession: (sessionId: string) => deleteSchedulesBySessionStmt.run(sessionId),
}

// ── Artifact queries ──────────────────────────────────────────────────────────

const listArtifactsByProjectStmt = db.prepare(
  `SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at ASC`
)
const findArtifactByIdStmt = db.prepare(
  `SELECT * FROM artifacts WHERE id = ?`
)
const findArtifactByProjectAndNameStmt = db.prepare(
  `SELECT * FROM artifacts WHERE project_id = ? AND name = ? COLLATE NOCASE LIMIT 1`
)
const insertArtifactStmt = db.prepare(
  `INSERT INTO artifacts (id, project_id, name, type, path, metadata, created_from_session)
   VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
)
const updateArtifactStmt = db.prepare(
  `UPDATE artifacts SET name = COALESCE(?, name), metadata = COALESCE(?, metadata),
   updated_at = unixepoch() WHERE id = ? RETURNING *`
)
const deleteArtifactStmt = db.prepare(
  `DELETE FROM artifacts WHERE id = ?`
)

export const artifactQueries = {
  listByProject: (projectId: string): Artifact[] =>
    listArtifactsByProjectStmt.all(projectId) as unknown as Artifact[],
  findById: (id: string): Artifact | undefined =>
    findArtifactByIdStmt.get(id) as unknown as Artifact | undefined,
  findByProjectAndName: (projectId: string, name: string): Artifact | undefined =>
    findArtifactByProjectAndNameStmt.get(projectId, name) as unknown as Artifact | undefined,
  create: (artifact: Omit<Artifact, 'created_at' | 'updated_at'>): Artifact =>
    insertArtifactStmt.get(
      artifact.id,
      artifact.project_id,
      artifact.name,
      artifact.type,
      artifact.path,
      artifact.metadata ?? null,
      artifact.created_from_session ?? null
    ) as unknown as Artifact,
  update: (id: string, patch: { name?: string; metadata?: string }): Artifact | undefined =>
    updateArtifactStmt.get(patch.name ?? null, patch.metadata ?? null, id) as unknown as Artifact | undefined,
  delete: (id: string): void => {
    deleteArtifactStmt.run(id)
  },
}

// ── Topic queries ─────────────────────────────────────────────────────────────

const listTopicsByProjectStmt = db.prepare(
  `SELECT * FROM topics WHERE project_id = ? ORDER BY created_at ASC`
)
const findTopicByIdStmt = db.prepare(`SELECT * FROM topics WHERE id = ?`)
const insertTopicStmt = db.prepare(
  `INSERT INTO topics (id, project_id, name) VALUES (?, ?, ?) RETURNING *`
)
const updateTopicStmt = db.prepare(
  `UPDATE topics SET name = ? WHERE id = ? RETURNING *`
)
const deleteTopicStmt = db.prepare(`DELETE FROM topics WHERE id = ?`)
const moveArtifactToTopicStmt = db.prepare(
  `UPDATE artifacts SET topic_id = ?, updated_at = unixepoch() WHERE id = ? RETURNING *`
)

export const topicQueries = {
  listByProject: (projectId: string): Topic[] =>
    listTopicsByProjectStmt.all(projectId) as unknown as Topic[],
  findById: (id: string): Topic | undefined =>
    findTopicByIdStmt.get(id) as unknown as Topic | undefined,
  create: (id: string, projectId: string, name: string): Topic =>
    insertTopicStmt.get(id, projectId, name) as unknown as Topic,
  update: (id: string, name: string): Topic | undefined =>
    updateTopicStmt.get(name, id) as unknown as Topic | undefined,
  delete: (id: string): void => { deleteTopicStmt.run(id) },
  moveArtifact: (artifactId: string, topicId: string | null): Artifact | undefined =>
    moveArtifactToTopicStmt.get(topicId, artifactId) as unknown as Artifact | undefined,
}

// ── App config types + queries ────────────────────────────────────────────────

export type AppConfig = {
  id: string
  project_id: string
  name: string
  type: string
  command_template: string
  work_dir: string
  created_at: number
  updated_at: number
}

export type AppSlotStatus = 'stopped' | 'starting' | 'running' | 'error'

export type AppSlot = {
  slot: number
  config_id: string | null
  status: AppSlotStatus
  pid: number | null
  started_at: number | null
  error: string | null
}

const insertAppConfigStmt = db.prepare(
  `INSERT INTO app_configs (id, project_id, name, type, command_template, work_dir)
   VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
)
const listAppConfigsByProjectStmt = db.prepare(
  `SELECT * FROM app_configs WHERE project_id = ? ORDER BY created_at ASC`
)
const findAppConfigByIdStmt = db.prepare(`SELECT * FROM app_configs WHERE id = ?`)
const updateAppConfigStmt = db.prepare(
  `UPDATE app_configs
   SET name = COALESCE(?, name),
       command_template = COALESCE(?, command_template),
       work_dir = COALESCE(?, work_dir),
       updated_at = unixepoch()
   WHERE id = ? RETURNING *`
)
const deleteAppConfigStmt = db.prepare(`DELETE FROM app_configs WHERE id = ?`)
const countAllAppConfigsStmt = db.prepare(`SELECT COUNT(*) as n FROM app_configs`)

const listAllAppSlotsStmt = db.prepare(`SELECT * FROM app_slots ORDER BY slot ASC`)
const findAppSlotByConfigStmt = db.prepare(
  `SELECT * FROM app_slots WHERE config_id = ?`
)
const findFreeAppSlotStmt = db.prepare(
  `SELECT * FROM app_slots WHERE config_id IS NULL ORDER BY slot ASC LIMIT 1`
)
const assignAppSlotStmt = db.prepare(
  `UPDATE app_slots SET config_id = ?, status = 'starting', pid = NULL, started_at = NULL, error = NULL
   WHERE slot = ?`
)
const markAppSlotRunningStmt = db.prepare(
  `UPDATE app_slots SET status = 'running', pid = ?, started_at = unixepoch() WHERE slot = ?`
)
const markAppSlotStoppedStmt = db.prepare(
  `UPDATE app_slots SET config_id = NULL, status = 'stopped', pid = NULL, started_at = NULL, error = NULL
   WHERE slot = ?`
)
const markAppSlotErrorStmt = db.prepare(
  `UPDATE app_slots SET status = 'error', pid = NULL, error = ? WHERE slot = ?`
)
const resetStaleAppSlotsStmt = db.prepare(
  `UPDATE app_slots SET config_id = NULL, status = 'stopped', pid = NULL, started_at = NULL, error = 'sidecar restarted'
   WHERE status IN ('starting', 'running')`
)

export const appConfigQueries = {
  create: (id: string, projectId: string, name: string, type: string, commandTemplate: string, workDir: string) =>
    insertAppConfigStmt.get(id, projectId, name, type, commandTemplate, workDir) as AppConfig,
  listByProject: (projectId: string) =>
    listAppConfigsByProjectStmt.all(projectId) as AppConfig[],
  findById: (id: string) =>
    findAppConfigByIdStmt.get(id) as AppConfig | undefined,
  update: (id: string, patch: { name?: string; command_template?: string; work_dir?: string }) =>
    updateAppConfigStmt.get(patch.name ?? null, patch.command_template ?? null, patch.work_dir ?? null, id) as AppConfig,
  delete: (id: string) =>
    deleteAppConfigStmt.run(id),
  countAll: () =>
    (countAllAppConfigsStmt.get() as { n: number }).n,
}

export const appSlotQueries = {
  listAll: () =>
    listAllAppSlotsStmt.all() as AppSlot[],
  findByConfigId: (configId: string) =>
    findAppSlotByConfigStmt.get(configId) as AppSlot | undefined,
  findFreeSlot: () =>
    findFreeAppSlotStmt.get() as AppSlot | undefined,
  assign: (slot: number, configId: string) =>
    assignAppSlotStmt.run(configId, slot),
  markRunning: (slot: number, pid: number) =>
    markAppSlotRunningStmt.run(pid, slot),
  markStopped: (slot: number) =>
    markAppSlotStoppedStmt.run(slot),
  markError: (slot: number, error: string) =>
    markAppSlotErrorStmt.run(error, slot),
  resetStale: () =>
    resetStaleAppSlotsStmt.run(),
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
