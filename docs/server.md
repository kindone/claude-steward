# Server Architecture

Node.js 23 + TypeScript (ESM) + Express 5. Serves the REST/SSE API and, in production, the built client as static files.

---

## Directory Layout

```
server/src/
├── index.ts          ← entry point: dotenv, validateEnv(), workerClient.connect(), recover hook, listen
├── app.ts            ← createApp() factory (exported for tests)
├── auth/
│   └── middleware.ts ← requireApiKey — Bearer token check on all /api routes
├── claude/
│   ├── process.ts    ← spawnClaude(): direct CLI spawn (fallback when worker unavailable)
│   └── toolDetail.ts ← extractToolDetail() — shared tool pill metadata (chat route, worker, recovery)
├── db/
│   └── index.ts      ← schema, migrations, projectQueries/sessionQueries/messageQueries
├── lib/
│   ├── connections.ts     ← global Set<Response> for app-level SSE fan-out
│   ├── sessionWatchers.ts ← Map<sessionId, Set<Response>> for session completion watch
│   ├── activeChats.ts     ← Map<sessionId, AbortController> for direct-spawn stop
│   └── pushNotifications.ts
├── worker/           ← Claude worker IPC (see [worker-protocol](worker-protocol.md))
│   ├── main.ts       ← Unix socket server; get_result / status / start / stop
│   ├── job-manager.ts← spawn Claude; accumulate text + tool_calls → worker.db
│   ├── client.ts     ← HTTP-side NDJSON socket; onReconnected → recoverStreamingSessions
│   ├── recovery.ts   ← finalize streaming rows after worker reconnect; merges tool_calls from chunks or result_reply
│   ├── db.ts         ← worker.db jobs table (content, tool_calls, status)
│   └── protocol.ts   ← WorkerCommand / WorkerEvent types
└── routes/
    ├── chat.ts       ← POST /api/chat (worker path + direct-spawn fallback)
    ├── sessions.ts   ← CRUD + GET /:id/messages (paginated) + GET /:id/watch (SSE)
    ├── projects.ts
    ├── events.ts
    └── admin.ts
```

The `createApp()` / `listen` split exists so tests can import `createApp()` without binding a port.

---

## Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/meta` | none | App metadata: `{ appRoot }` |
| `POST` | `/api/chat` | ✓ | Start SSE stream; delegates to **worker** when connected, else **direct spawn** (`process.ts`) |
| `DELETE` | `/api/chat/:sessionId` | ✓ | Stop job: worker `stop` + `abortChat` for direct path; returns `{ stopped: bool }` |
| `GET` | `/api/sessions` | ✓ | List sessions; optional `?projectId=` filter |
| `POST` | `/api/sessions` | ✓ | Create session; `projectId` required in body |
| `PATCH` | `/api/sessions/:id` | ✓ | Update session fields: `{ title?, systemPrompt?, permissionMode? }` |
| `DELETE` | `/api/sessions/:id` | ✓ | Delete session and its messages |
| `GET` | `/api/sessions/:id/messages` | ✓ | Paginated message history (see below) |
| `GET` | `/api/sessions/:id/watch` | ✓ | SSE; fires `event: done` when Claude's response lands in DB (see below) |
| `GET` | `/api/projects` | ✓ | List projects |
| `POST` | `/api/projects` | ✓ | Create project (validates path exists and is a directory) |
| `PATCH` | `/api/projects/:id` | ✓ | Update project fields |
| `DELETE` | `/api/projects/:id` | ✓ | Delete project; returns 403 if path matches `APP_ROOT` |
| `GET` | `/api/projects/:id/files` | ✓ | List directory contents; `?path=` subpath (see [File Browser](file-browser.md)) |
| `GET` | `/api/projects/:id/files/content` | ✓ | UTF-8 file content + `lastModified` mtime (1 MB cap) |
| `GET` | `/api/projects/:id/files/raw` | ✓ | Binary file with detected MIME type (images, pdf) |
| `PATCH` | `/api/projects/:id/files` | ✓ | Atomic file write with optimistic locking |
| `POST` | `/api/projects/:id/exec` | ✓ | SSE; streams shell command output (see [Terminal](terminal.md)) |
| `GET` | `/api/events` | ✓ | App-level SSE (reload, future notifications) |
| `GET` | `/api/push/vapid-public-key` | ✓ | Returns `{ key }` for client subscription setup |
| `POST` | `/api/push/subscribe` | ✓ | Upsert push subscription `{ endpoint, keys: { p256dh, auth } }` |
| `DELETE` | `/api/push/subscribe` | ✓ | Remove subscription by `{ endpoint }` |
| `GET` | `/api/admin/version` | ✓ | Package version |
| `POST` | `/api/admin/reload` | ✓ | Broadcast reload event then `process.exit(0)` |

File routes use `safeResolvePath()` to prevent path traversal; dotfiles are filtered from directory listings. For file browser and editor details see [File Browser](file-browser.md). For the exec endpoint see [Terminal](terminal.md).

### Message Pagination

`GET /api/sessions/:id/messages` supports cursor-based pagination via query parameters:

| Param | Default | Description |
|---|---|---|
| `limit` | (returns all) | Max messages to return; values 1–200 |
| `before` | — | Message `id`; returns messages older than this cursor |

When `limit` is supplied the response changes from a plain `Message[]` array to:

```json
{ "messages": [...], "hasMore": true }
```

The query uses `rowid DESC LIMIT limit+1` (or adds a `rowid < cursor_rowid` clause when `before` is set). The extra +1 row detects whether more pages exist without a separate `COUNT` query. Results are reversed to ascending display order before returning.

Legacy callers that omit both params still receive a plain `Message[]` array.

### Session Watch Endpoint

`GET /api/sessions/:id/watch` is a lightweight SSE connection that parks until the session's Claude response is persisted, then fires `event: done` and closes.

This replaces client-side polling (previously: up to 60 ticks × 2 s = 2-minute cap). The server fires `event: done` the instant `onComplete` writes the assistant message to the DB, regardless of how long Claude takes.

```
Client navigates to session with pending user message
  → GET /api/sessions/:id/watch
  → server checks last message role:
      assistant → sends event: done immediately, closes
      user      → registers res in sessionWatchers Map
                  → sends ": ping" every 30s (nginx keepalive)
  → chat route onComplete fires
      → messageQueries.insert(assistantText)
      → notifyWatchers(sessionId) → sends event: done to all watchers
  → client receives done, fetches latest messages, clears spinner
```

Implementation: `server/src/lib/sessionWatchers.ts` holds a `Map<sessionId, Set<Response>>`. `addWatcher` / `removeWatcher` manage the set; `notifyWatchers` sends `event: done` and clears.

---

## Session Lifecycle

On startup, `migrateOrphanedSessions(APP_ROOT)` runs once: any sessions with `project_id IS NULL` are reassigned to the steward project (identified by path = `APP_ROOT`). This is a one-time idempotent cleanup from before project-scoping was enforced.

```
POST /api/sessions   { projectId }    ← required; 400 if absent
  → INSERT { id: uuid, title: "New Chat", claude_session_id: null, project_id }

First message (POST /api/chat):
  → title derived from message text (≤40 chars, word boundary)
  → title UPDATE + SSE title event emitted before first token
  → user message INSERTed
  → spawnClaude called; system.init chunk → claude_session_id stored
  → result chunk → assistant message INSERTed, SSE done event, res.end()

Subsequent messages:
  → --resume <claude_session_id> passed to CLI
  → Claude maintains full conversation context internally

Resume failure:
  → Claude exits non-zero, no result chunk received
  → server sends structured error event { message, code: 'session_expired', detail }
  → onError callback clears claude_session_id from DB
  → next message starts a fresh session automatically
```

---

## Chat SSE Protocol

`POST /api/chat` responds with `Content-Type: text/event-stream`. Events in order:

| Event | Data | When |
|---|---|---|
| `title` | `{ title: string }` | First message only; emitted before any Claude output |
| `chunk` | Raw Claude NDJSON object | Every line from Claude stdout |
| `done` | `{ session_id: string }` | After Claude `result` chunk; server closes response |
| `error` | `{ message, code, detail? }` | Spawn error or non-zero exit |

Error codes (SSE `error` event and persisted `messages.error_code`):
- `session_expired` — `--resume` attempt failed; `claude_session_id` cleared automatically
- `context_limit` — context window exceeded; client may offer compact flow
- `process_error` — other failures
- `connection_lost` — **client-only classification**: stream ended without `done`/`error` (e.g. HTTP server restarted mid-stream). Not sent as SSE `error` from server; `sendMessage` synthesizes this so `ChatWindow` can switch to `watchSession` instead of a permanent error bubble when the worker may still complete the job.

### Worker path vs direct spawn

When `workerClient.isConnected()`:
- A **`messages` row** is inserted with `status = 'streaming'` immediately; content and **`tool_calls`** (JSON) are updated during the run and finalized on `done`/`error`.
- **`worker.db.jobs`** stores parallel state including **`tool_calls`** at job completion so **`get_result` / `result_reply`** can promote tool metadata after an HTTP-only restart (see [worker-protocol](worker-protocol.md)).

When the worker is down, **`spawnClaude`** in `process.ts` runs in-process; streaming rows are not used; **`tool_calls`** are not persisted on that path (see `TODO.md`).

---

## Claude Subprocess (`process.ts`)

`spawnClaude()` is the single place that touches the `claude` binary.

### Arguments

```
claude --print <message>
       --output-format stream-json
       --verbose
       --include-partial-messages
       [--resume <claude_session_id>]
       [--system-prompt <text>]
       [--permission-mode plan|acceptEdits|bypassPermissions]
```

`permission_mode` is stored per session (default `acceptEdits`). `default` mode is intentionally never passed — it would stall waiting for interactive approval.

### NDJSON line handling

| Line type | Action |
|---|---|
| `system.init` | Extract `session_id`; call `onSessionId()` once |
| `stream_event` + `content_block_delta` | Accumulate text; forward as SSE `chunk` |
| `result` | Call `onComplete(accumulatedText)`; send SSE `done`; `res.end()` |
| anything else | Forward as SSE `chunk` |

### Critical Gotchas

**1. `CLAUDECODE=1` causes hanging**
When spawned from inside a Claude Code session the child inherits `CLAUDECODE=1`, making it wait for IPC from a parent session that never responds. Fix: strip all env vars starting with `CLAUDE` before spawning. The child authenticates via `~/.claude/` credentials.

**2. `CI=true` required for pipe output**
`--output-format stream-json` suppresses all output when stdout is a pipe (TTY detection). Fix: always set `CI=true` in the spawn env.

**3. Close stdin**
Use `stdio: ['ignore', 'pipe', 'pipe']`. Without `'ignore'`, Claude may block waiting for stdin.

**4. `req.on('close')` fires too early**
Express fires `req.on('close')` when the request body is consumed — not on client disconnect. Fix: use `res.on('close')` for SSE cleanup.

**5. No `assistant` chunk fallback**
With `--include-partial-messages`, `stream_event.content_block_delta` delivers tokens incrementally. The final `assistant` chunk duplicates the full text. Fix: only handle `content_block_delta`; ignore the `assistant` chunk type.

---

## Testing

Server tests use **Vitest + supertest**. Each test file gets an isolated SQLite database via `server/src/__tests__/setup.ts`:

```ts
// Unique temp DB per test file (workerId + timestamp)
process.env.DATABASE_PATH = `/tmp/steward-test-${workerId}-${Date.now()}.db`
```

`spawnClaude` is mocked with `vi.mock` in `chat.test.ts` so no real Claude CLI invocations occur.

```bash
npm test --workspace=server    # run server tests only
npm run test:coverage          # with coverage report
```

---

## Push Notifications

Uses the **Web Push API** with VAPID authentication (`web-push` npm package).

### Setup

Generate a VAPID key pair once and store in `.env` **and** in `ecosystem.dev.config.cjs` (PM2 env section):

```bash
npx web-push generate-vapid-keys
```

Required env vars:
```
VAPID_PUBLIC_KEY=<base64url>
VAPID_PRIVATE_KEY=<base64url>
VAPID_SUBJECT=mailto:admin@example.com
```

> **Important — ESM module evaluation order**: In ESM, all `import` statements are evaluated before the importing module's body runs. This means `dotenv.config()` in `index.ts` fires *after* all imported modules have already evaluated their top-level code. Any module that reads `process.env.*` at the top level (outside a function) will see undefined values. `pushNotifications.ts` avoids this by reading env vars **lazily inside functions** (`isPushEnabled()`, `notifyAll()`).
>
> Additionally, PM2 only applies new ecosystem config env vars when started with `--update-env`. Plain `pm2 restart` keeps the old env snapshot. To apply new vars: `pm2 restart ecosystem.dev.config.cjs --only steward-server --update-env`.

### Flow

1. Client registers `sw.js` on app load; `usePushNotifications` hook calls `POST /api/push/subscribe` with `{ endpoint, keys }` → stored in `push_subscriptions` table
2. On `onComplete` in `chat.ts`: if `notifyWatchers()` returns 0 (no browser tab open), `notifyAll()` fans out a push to all stored subscriptions
3. `sw.js` `push` event fires → `showNotification()`; `notificationclick` → focuses existing tab or `openWindow('/?session=...')`
4. Stale subscriptions (HTTP 410/404 from push service) are auto-deleted

---

## Development & Production

```bash
# Development
npm run dev --workspace=server   # tsx watch src/index.ts — hot-reload TypeScript

# Production
npm run build    # tsc → dist/
npm start        # node dist/index.js — serves static client + API on :3001
```

In production, `NODE_ENV=production` enables static file serving from `server/public/` (populated by the client build) and disables CORS.
