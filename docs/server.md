# Server Architecture

Node.js 23 + TypeScript (ESM) + Express 5. Serves the REST/SSE API and, in production, the built client as static files.

---

## Directory Layout

```
server/src/
├── index.ts          ← entry point: dotenv load, createApp(), listen
├── app.ts            ← createApp() factory (exported for tests)
├── auth/
│   └── middleware.ts ← requireApiKey — Bearer token check on all /api routes
├── claude/
│   └── process.ts    ← spawnClaude(): CLI spawn, NDJSON → SSE pipe, error handling
├── db/
│   └── index.ts      ← schema, migrations, projectQueries/sessionQueries/messageQueries
├── lib/
│   ├── connections.ts     ← global Set<Response> for app-level SSE fan-out
│   └── sessionWatchers.ts ← Map<sessionId, Set<Response>> for session completion watch
└── routes/
    ├── chat.ts        ← POST /api/chat
    ├── sessions.ts    ← CRUD + GET /:id/messages (paginated) + GET /:id/watch (SSE)
    ├── projects.ts    ← CRUD + file listing/content/raw/write + POST /:id/exec
    ├── events.ts      ← GET /api/events (app-level SSE)
    └── admin.ts       ← GET /api/admin/version, POST /api/admin/reload
```

The `createApp()` / `listen` split exists so tests can import `createApp()` without binding a port.

---

## Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/meta` | none | App metadata: `{ appRoot }` |
| `POST` | `/api/chat` | ✓ | Start SSE stream; spawns Claude subprocess |
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

Error codes:
- `session_expired` — `--resume` attempt failed; `claude_session_id` cleared automatically
- `process_error` — any other non-zero exit; `detail` contains stderr

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

## Development & Production

```bash
# Development
npm run dev --workspace=server   # tsx watch src/index.ts — hot-reload TypeScript

# Production
npm run build    # tsc → dist/
npm start        # node dist/index.js — serves static client + API on :3001
```

In production, `NODE_ENV=production` enables static file serving from `server/public/` (populated by the client build) and disables CORS.
