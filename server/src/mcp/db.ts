/**
 * Lean standalone SQLite module for the MCP schedule server process.
 *
 * This runs in a SEPARATE child process (spawned by Claude CLI via --mcp-config)
 * so it CANNOT share the main server's DatabaseSync singleton. It opens its own
 * connection to the same steward.db file using WAL mode for safe concurrent access.
 *
 * Only exposes the schedule queries needed by the MCP tools — nothing else.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

// Resolve DB path: env override or default relative to this file's location.
// In production: server/dist/mcp/db.js → server/steward.db (two levels up)
// In dev (tsx):  server/src/mcp/db.ts  → server/steward.db (two levels up)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH ?? path.join(__dirname, '../../steward.db')

const db = new DatabaseSync(DB_PATH)

// WAL mode + busy timeout for safe concurrent access with the main server process.
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA busy_timeout = 5000')

// ── Prepared statements ────────────────────────────────────────────────────────

const listBySessionStmt = db.prepare(
  `SELECT * FROM schedules WHERE session_id = ? ORDER BY created_at ASC`
)

const findByIdStmt = db.prepare(
  `SELECT * FROM schedules WHERE id = ? LIMIT 1`
)

const findBySessionAndLabelStmt = db.prepare(
  `SELECT * FROM schedules WHERE session_id = ? AND label = ? AND label != '' LIMIT 1`
)

const upsertStmt = db.prepare(
  `INSERT INTO schedules (id, session_id, cron, prompt, label, enabled, once, next_run_at)
   VALUES (?, ?, ?, ?, ?, 1, ?, ?)
   ON CONFLICT(session_id, label) WHERE label != '' DO UPDATE SET
     cron        = excluded.cron,
     prompt      = excluded.prompt,
     once        = excluded.once,
     next_run_at = excluded.next_run_at,
     updated_at  = unixepoch()
   RETURNING *`
)

const updateStmt = db.prepare(
  `UPDATE schedules
   SET cron        = COALESCE(?, cron),
       prompt      = COALESCE(?, prompt),
       enabled     = COALESCE(?, enabled),
       next_run_at = COALESCE(?, next_run_at),
       updated_at  = unixepoch()
   WHERE id = ?
   RETURNING *`
)

const deleteStmt = db.prepare(`DELETE FROM schedules WHERE id = ?`)

// ── Row type ───────────────────────────────────────────────────────────────────

export type ScheduleRow = {
  id: string
  session_id: string
  cron: string
  prompt: string
  label: string | null
  enabled: number
  once: number
  last_run_at: number | null
  next_run_at: number | null
  created_at: number
  updated_at: number
}

// ── Queries ────────────────────────────────────────────────────────────────────

export const mcpScheduleDb = {
  listBySession: (sessionId: string): ScheduleRow[] =>
    listBySessionStmt.all(sessionId) as ScheduleRow[],

  findById: (id: string): ScheduleRow | undefined =>
    findByIdStmt.get(id) as ScheduleRow | undefined,

  findBySessionAndLabel: (sessionId: string, label: string): ScheduleRow | undefined =>
    findBySessionAndLabelStmt.get(sessionId, label) as ScheduleRow | undefined,

  /** Insert or update by (session_id, label) conflict key. */
  upsert: (
    id: string,
    sessionId: string,
    cronExpr: string,
    prompt: string,
    label: string,
    once: boolean,
    nextRunAt: number | null,
  ): ScheduleRow =>
    upsertStmt.get(id, sessionId, cronExpr, prompt, label, once ? 1 : 0, nextRunAt) as ScheduleRow,

  update: (
    id: string,
    patch: { cron?: string; prompt?: string; enabled?: boolean; nextRunAt?: number | null },
  ): ScheduleRow | undefined =>
    updateStmt.get(
      patch.cron ?? null,
      patch.prompt ?? null,
      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : null,
      patch.nextRunAt !== undefined ? patch.nextRunAt : null,
      id,
    ) as ScheduleRow | undefined,

  delete: (id: string): void => { deleteStmt.run(id) },
}
