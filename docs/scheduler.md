# Scheduler — Architecture

How the steward scheduler works internally. For tool usage (how to create/manage schedules from a session), see `docs/scheduler-usage.md`.

---

## Overview

Scheduled conversation resume: Claude-initiated messages, timezone-aware cron, push notification on fire. Schedules are created via MCP tool calls from within chat sessions (or via the REST API). The scheduler fires them as headless Claude invocations and notifies the client via SSE.

---

## Server Components

### `schedules` DB Table

```sql
CREATE TABLE schedules (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  cron        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  label       TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  once        INTEGER NOT NULL DEFAULT 0,   -- auto-delete after first fire
  condition   TEXT,                         -- JSON ScheduleCondition, null = no condition
  expires_at  INTEGER,                      -- unix seconds; auto-delete when now > expires_at
  last_run_at INTEGER,
  next_run_at INTEGER,                      -- pre-computed next UTC unix timestamp
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
)
```

Unique index on `(session_id, label)` — enables upsert-by-label semantics in `schedule_create`.

`next_run_at` is computed by `nextFireAt(cronExpr)` (node-cron validation + cron-parser next date) and advanced immediately when a schedule fires to prevent double-fire.

`listDue(now)` filters out expired schedules: `expires_at IS NULL OR expires_at > now`.

### `lib/scheduler.ts`

`startScheduler()` registers a `node-cron` tick every minute. On each tick:
1. `scheduleQueries.listDue(now)` returns enabled, due, non-expired schedules
2. **Condition check**: if `schedule.condition` is set, `evaluateCondition(condition, now)` is called. If false → advance `next_run_at` and return without firing.
3. `markRan()` advances `next_run_at` immediately (prevents double-fire)
4. If `once`, deletes the schedule. If `expires_at` is set and `nextRun > expires_at`, deletes (last fire reached).
5. Broadcasts `schedules_changed` SSE so the bell panel refreshes
6. `sendToSession()` sends the prompt to the session as a headless invocation
7. If no watchers are open → push notification fires

**Exported pure functions** (testable):
- `nextFireAt(cronExpr)` — next UTC unix timestamp for a cron, or null if invalid
- `evaluateCondition(condition, now)` — returns true if the condition passes for the given UTC date
- `countFiresBeforeExpiry(cronExpr, firstFire, expiresAt)` — used by MCP server for expiry warnings

**Condition types** (`ScheduleCondition`):
```typescript
{ type: 'every_n_days'; n: number; ref: string }   // ref = YYYY-MM-DD UTC anchor
{ type: 'last_day_of_month' }
{ type: 'nth_weekday'; n: number; weekday: number } // weekday: 0=Sun … 6=Sat
```

### `lib/sendToSession.ts`

Headless Claude invocation used by the scheduler (and manual run). Injects the rich scheduled-trigger context as the user turn, then calls `runClaudePrompt()`. Saves the assistant message with `source = 'scheduler'`. Calls `notifyWatchers` and `notifySubscribers` when done.

### `lib/schedulePrompt.ts`

`buildScheduleFragment(session)` returns the lean system prompt injection prepended to every session. Contains: MCP tool signatures, current time, user timezone, cron limitations. This is the tool usage guide — keep it concise to minimise token overhead.

### Routes (`/api/schedules`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/schedules?sessionId=` | List schedules for a session |
| `POST` | `/api/schedules` | Create schedule `{ sessionId, cron, prompt, label?, once? }` |
| `PATCH` | `/api/schedules/:id` | Update `{ cron?, prompt?, label?, enabled? }` |
| `DELETE` | `/api/schedules/:id` | Delete schedule |
| `POST` | `/api/schedules/:id/run` | Manually fire immediately |
| `POST` | `/api/mcp-notify` | Internal: MCP server posts here after mutations → SSE broadcast |

All mutation routes broadcast `schedules_changed` SSE so the bell panel refreshes in real time.

---

## MCP Server

```
Claude CLI subprocess
    └── steward-schedules MCP server (stdio)
            ├── reads/writes steward.db (WAL mode, busy_timeout=5000)
            └── POSTs to /api/mcp-notify on mutations → schedules_changed SSE
```

- **Config**: `server/src/mcp/config.ts` writes `server/data/steward-mcp.json` at startup. Sets `MCP_CONFIG_PATH` and `MCP_NOTIFY_SECRET` env vars inherited by the worker.
- **DB**: `server/src/mcp/db.ts` — separate SQLite connection in WAL mode for concurrent access.
- **Disallowed tools**: worker (`job-manager.ts`) and direct-spawn (`process.ts`) both pass `--disallowed-tools CronCreate,CronDelete` when `MCP_CONFIG_PATH` is set.
- **Claude Code sessions**: on every startup, `syncClaudeSettings()` in `config.ts` writes the registration into `~/.claude.json` (the file Claude Code actually reads — **not** `.claude/settings.json`). This keeps the MCP secret in sync after every PM2 restart. See [External: `~/.claude.json`](#external-claudejson) below.

---

## External: `~/.claude.json`

The MCP server registration lives **outside the repo** in `~/.claude.json` (Claude Code's global config file). This file is auto-maintained by `syncClaudeSettings()` on every server startup.

### What `syncClaudeSettings()` does

On startup, `server/src/mcp/config.ts`:
1. Generates (or reads from env) `MCP_NOTIFY_SECRET`
2. Builds `mcpConfig` with `command: process.execPath` (NVM v24 node — **not** `/usr/bin/node` which is v18 and lacks `node:sqlite`)
3. Writes `server/data/steward-mcp.json`
4. Calls `syncClaudeSettings(mcpConfig)` which merges the entry into `~/.claude.json` under `mcpServers["steward-schedules"]`

### Why this matters

- `MCP_NOTIFY_SECRET` is regenerated each restart if not set as a persistent env var. `syncClaudeSettings` ensures `~/.claude.json` always has the current secret.
- Claude Code reads `~/.claude.json` for MCP server registrations — **not** `~/.claude/settings.json`, not `.claude/settings.json`.
- The node binary must be NVM v24+ (`process.execPath`). If the entry ever gets reset to `/usr/bin/node` (v18), the MCP server will crash silently with `node:sqlite` not found.

### Recovery (if `~/.claude.json` gets corrupted or the entry disappears)

```bash
# Re-register manually — this writes to ~/.claude.json.
# Use `which node` to get the absolute path of your active node binary
# (must be v24+ — if `which node` resolves to /usr/bin/node v18, the MCP
# server will crash with `node:sqlite` not found).
claude mcp add steward-schedules -s user \
  -- "$(which node)" \
  "$(pwd)/server/dist/mcp/schedule-server.js"

# Then set the secret to match the running server
MCP_NOTIFY_SECRET=$(cat server/data/steward-mcp.json | \
  python3 -c "import json,sys; print(json.load(sys.stdin)['env']['MCP_NOTIFY_SECRET'])")
claude mcp update steward-schedules --env MCP_NOTIFY_SECRET="$MCP_NOTIFY_SECRET"

# Verify
claude mcp list
```

The next server restart will re-sync it automatically anyway.

---

## Client

### Real-time Bell Panel Refresh

`schedules_changed` SSE → `api.ts` `onSchedulesChanged` → `useAppConnection` → `App.tsx` increments `schedulesTick` → `ChatWindow` sums with internal `scheduleTick` → `SchedulePanel` re-fetches.

### Schedule Panel

Bell icon (🔔) in `ChatWindow` header. Lists schedules with:
- **Label** as primary identifier (falls back to truncated prompt)
- **Natural language cron description** via `cronstrue`, shifted to the session's local timezone (e.g. "At 18:00, Monday through Friday" instead of "At 09:00 UTC"). Relative crons (`*/5 * * * *`) are timezone-agnostic and shown without conversion. Falls back to "(UTC)" label if shift can't be computed.
- **Condition description** in plain English if set (e.g. "Every other week (from 2026-04-06)")
- **Expiry** in amber if `expires_at` is set (e.g. "Until Apr 30 at 5:00 PM KST")
- **Next / last run** times in local timezone with abbreviation (e.g. "Mon, Apr 7, 6:00 PM KST")
- Enabled toggle, run-now (▶), delete (×)

Read-only — schedules are managed via MCP tools, not this panel.

### Fired Messages

`source = 'scheduler'` messages render a `⏰ Scheduled` indicator. No visible user turn is saved.

### Push on Fire

After `sendToSession()` completes, if no watcher tab is open, a push notification fires. Session-targeted subscriptions tried first; global subscriptions as fallback. URL includes `?session=<id>&project=<id>` for reliable mobile navigation.

---

## Timezone

Stored per session (`sessions.timezone`). `ChatWindow` sends `Intl.DateTimeFormat().resolvedOptions().timeZone` on mount via `PATCH /api/sessions/:id`. All cron expressions are stored and evaluated in UTC.
