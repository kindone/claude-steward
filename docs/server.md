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
│   └── connections.ts ← global Set<Response> for app-level SSE fan-out
└── routes/
    ├── chat.ts        ← POST /api/chat
    ├── sessions.ts    ← GET/POST/DELETE /api/sessions, GET /:id/messages
    ├── projects.ts    ← GET/POST/DELETE /api/projects, file listing + content
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
| `GET` | `/api/sessions/:id/messages` | ✓ | Full message history |
| `GET` | `/api/projects` | ✓ | List projects |
| `POST` | `/api/projects` | ✓ | Create project (validates path exists and is a directory) |
| `PATCH` | `/api/projects/:id` | ✓ | Update project fields (legacy `permissionMode`; use session-level instead) |
| `DELETE` | `/api/projects/:id` | ✓ | Delete project; returns 403 if path matches `APP_ROOT` |
| `GET` | `/api/projects/:id/files` | ✓ | List directory contents; `?path=` subpath |
| `GET` | `/api/projects/:id/files/content` | ✓ | Return file content (1 MB cap) |
| `GET` | `/api/events` | ✓ | App-level SSE (reload, future notifications) |
| `GET` | `/api/admin/version` | ✓ | Package version |
| `POST` | `/api/admin/reload` | ✓ | Broadcast reload event then `process.exit(0)` |

File routes use `safeResolvePath()` to prevent path traversal; dotfiles are filtered from directory listings.

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
