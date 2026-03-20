/**
 * Worker-local SQLite DB. Ephemeral operational store — tracks in-flight Claude jobs.
 * Owned exclusively by the worker process; no other process writes to this file.
 * steward.db (HTTP server) is the persistent source of truth.
 */

import { DatabaseSync } from 'node:sqlite'

const DB_PATH = process.env.WORKER_DB_PATH ?? '/tmp/claude-worker.db'

const db = new DatabaseSync(DB_PATH)

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA busy_timeout = 5000')

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    session_id   TEXT PRIMARY KEY,
    status       TEXT NOT NULL DEFAULT 'running',
    content      TEXT NOT NULL DEFAULT '',
    error_code   TEXT,
    started_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
  )
`)

try {
  db.exec(`ALTER TABLE jobs ADD COLUMN tool_calls TEXT`)
} catch {
  /* already exists */
}

// ── Queries ───────────────────────────────────────────────────────────────────

const insertJobStmt = db.prepare(
  `INSERT OR REPLACE INTO jobs (session_id, status, content) VALUES (?, 'running', '')`
)
const updateContentStmt = db.prepare(
  `UPDATE jobs SET content = ?, updated_at = unixepoch() WHERE session_id = ?`
)
const updateStatusStmt = db.prepare(
  `UPDATE jobs SET status = ?, error_code = ?, content = ?, tool_calls = ?, updated_at = unixepoch() WHERE session_id = ?`
)
const findJobStmt = db.prepare(`SELECT * FROM jobs WHERE session_id = ?`)
const deleteJobStmt = db.prepare(`DELETE FROM jobs WHERE session_id = ?`)
const listRunningStmt = db.prepare(`SELECT * FROM jobs WHERE status = 'running'`)

export type JobRow = {
  session_id: string
  status: 'running' | 'complete' | 'interrupted'
  content: string
  error_code: string | null
  tool_calls: string | null
  started_at: number
  updated_at: number
}

export const jobQueries = {
  insert: (sessionId: string) =>
    insertJobStmt.run(sessionId),
  updateContent: (sessionId: string, content: string) =>
    updateContentStmt.run(content, sessionId),
  updateStatus: (
    sessionId: string,
    status: string,
    errorCode: string | null,
    content: string,
    toolCalls: string | null = null,
  ) => updateStatusStmt.run(status, errorCode, content, toolCalls, sessionId),
  find: (sessionId: string) =>
    findJobStmt.get(sessionId) as JobRow | undefined,
  delete: (sessionId: string) =>
    deleteJobStmt.run(sessionId),
  listRunning: () =>
    listRunningStmt.all() as JobRow[],
}

export default db
