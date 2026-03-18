# Claude Worker Protocol

Design document for the Claude worker process architecture. Tracks decisions, IPC protocol, DB schema, and migration steps.

---

## Motivation

Currently the HTTP server directly spawns Claude subprocesses. When `tsx watch` restarts the HTTP server (dev) or a manual restart occurs (prod), all in-flight Claude jobs are killed and their output is lost — the client sees a hung spinner or an empty response.

Splitting into a separate worker process means:
- Claude jobs survive HTTP server restarts
- Worker DB is a clean operational store, decoupled from the main DB
- Worker is independently testable (no HTTP layer needed)
- Clear contract between HTTP and Claude execution

---

## Architecture

```
┌──────────────────┐   Unix socket IPC    ┌─────────────────────┐
│   HTTP Server    │ ←──────────────────→ │   Claude Worker     │
│   (restartable)  │   NDJSON frames      │   (stable daemon)   │
│                  │                      │   spawns Claude CLI  │
│  steward.db      │                      │   writes worker.db  │
└──────────────────┘                      └─────────────────────┘
        ↑ SSE                                      ↓
   ┌────┴────┐                             worker.db (ephemeral)
   │ Client  │                             keyed by session_id
   └─────────┘
```

**steward.db** — persistent source of truth (messages, sessions, projects, auth, push subscriptions).
**worker.db** — ephemeral operational store (in-flight jobs, chunk buffers). Owned exclusively by the worker process; no cross-process writes.

On job completion the worker notifies the HTTP server, which reads the final content from worker.db and promotes it into steward.db as a completed message.

---

## IPC Transport

**Unix domain socket** at a configurable path (default `/tmp/claude-worker.sock`).

- Worker binds and listens on the socket
- HTTP server connects on first use; reconnects automatically if the socket is not yet available (worker starting up) or after HTTP server restart
- Both directions use **newline-delimited JSON (NDJSON)**: each message is a single JSON object followed by `\n`
- Framing is length-free; each line is one complete message

---

## IPC Messages

### HTTP Server → Worker (commands)

```ts
// Start a new Claude job
{ type: 'start', sessionId: string, prompt: string, claudeSessionId: string | null, projectPath: string, permissionMode: string, systemPrompt: string | null }

// Stop a running job (user pressed Stop)
{ type: 'stop', sessionId: string }

// Query status of a job
{ type: 'status', sessionId: string }
```

### Worker → HTTP Server (events)

```ts
// A new text chunk arrived from Claude
{ type: 'chunk', sessionId: string, text: string }

// A tool call started
{ type: 'tool_start', sessionId: string, toolUseId: string, toolName: string, toolInput: unknown }

// A tool result arrived
{ type: 'tool_result', sessionId: string, toolUseId: string, output: string, isError: boolean }

// Job completed successfully
{ type: 'done', sessionId: string, content: string, claudeSessionId: string }

// Job failed
{ type: 'error', sessionId: string, errorCode: string, content: string }

// Response to a status query
{ type: 'status_reply', sessionId: string, status: 'running' | 'idle' | 'unknown' }
```

---

## Worker DB Schema (worker.db)

Owned exclusively by the worker. Uses WAL mode. Schema is intentionally minimal — this is operational state, not persistent history.

```sql
CREATE TABLE jobs (
  session_id   TEXT PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'running',  -- running | complete | interrupted
  content      TEXT NOT NULL DEFAULT '',          -- accumulated assistant text
  error_code   TEXT,
  started_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE job_chunks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL REFERENCES jobs(session_id),
  type         TEXT NOT NULL,  -- text | tool_start | tool_result
  payload      TEXT NOT NULL,  -- JSON
  seq          INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
```

`jobs` holds the latest snapshot (content updated on each flush interval).
`job_chunks` holds the full ordered chunk log for complete recovery.

---

## steward.db Changes

Add `status` column to `messages`:

```sql
ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'complete';
-- Values: 'complete' | 'streaming' | 'interrupted'
```

On HTTP server boot: set any `status = 'streaming'` rows to `status = 'interrupted'` (the worker was killed before promoting them).

---

## Data Flow

### Happy path
```
POST /api/chat
  → HTTP server sends StartJob to worker via socket
  → worker inserts job row (status=running) in worker.db
  → worker spawns Claude CLI
  → chunks arrive → worker emits chunk events → HTTP server relays to SSE client
  → worker flushes accumulated content to jobs.content every 3s
  → Claude exits → worker emits done event
  → HTTP server writes final message to steward.db (status=complete)
  → worker marks job complete in worker.db
  → worker.db job row can be purged after TTL (e.g. 24h)
```

### Client reloads mid-stream
```
  → SSE connection drops
  → worker keeps running, keeps writing to worker.db
  → client reconnects → GET /api/sessions/:id → HTTP server checks worker for running job
  → HTTP server responds with { isRunning: true, partialContent: '...' }
  → client shows partial content + spinner
  → on done event → HTTP server notifies watchSession clients → client fetches complete message
```

### HTTP server restarts mid-stream
```
  → SSE drops, HTTP server process exits
  → worker keeps running, Claude keeps running
  → HTTP server comes back up → reconnects to worker socket
  → client reloads → same flow as "client reloads mid-stream" above
```

### Worker killed mid-stream (server reboot, OOM, etc.)
```
  → worker.db job stays at status=running (never updated to complete)
  → steward.db message stays at status=streaming (never promoted)
  → on next HTTP server boot: set streaming messages → interrupted
  → client sees "response interrupted" error banner with partial content from steward.db
  → partial content available only if the 3s flush had fired at least once
```

---

## Migration Steps

| Step | What changes | Ships value independently |
|------|-------------|--------------------------|
| 1 | **This doc** — define protocol, schema, data flow | Yes — alignment before code |
| 2 | **DB write-through** — add `messages.status`, flush partial content to steward.db every 3s during streaming; on-boot interrupted cleanup. No process split yet. | Yes — prevents data loss on server restart |
| 3 | **Extract JobManager** — move `spawnClaude` logic into `server/src/worker/job-manager.ts`; still imported directly by HTTP server. | Yes — enables unit testing of Claude spawn logic |
| 4 | **Worker process** — `server/src/worker/main.ts` entry point; listens on Unix socket; HTTP server connects and delegates job start/stop | Yes — worker survives HTTP server restarts |
| 5 | **Worker DB** — worker writes to worker.db; HTTP server promotes to steward.db on completion | Yes — full data separation |
| 6 | **Client reconnect UX** — detect in-progress sessions on load, show partial content + spinner | Yes — improves perceived reliability |
| 7 | **PM2 / process management** — add worker as a separate PM2 process; document startup order | Yes — production-grade deployment |
