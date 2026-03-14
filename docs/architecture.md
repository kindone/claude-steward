# Architecture

## Repository Structure

```
claude-steward/               ← npm workspace root
├── package.json              ← workspace config, concurrently dev script
├── .env                      ← secrets (gitignored)
├── .env.example              ← committed template
│
├── server/                   ← Node.js 23 + TypeScript (ESM)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts          ← Express entry point, dotenv, middleware wiring
│       ├── auth/
│       │   └── middleware.ts ← Bearer token check
│       ├── claude/
│       │   └── process.ts    ← claude CLI spawn, SSE pipe, env cleanup, onComplete accumulator
│       ├── db/
│       │   └── index.ts      ← node:sqlite setup, sessionQueries + messageQueries
│       ├── lib/
│       │   └── connections.ts ← global Set<Response> registry for app-level SSE
│       └── routes/
│           ├── chat.ts       ← POST /api/chat — SSE streaming, message persistence, AbortController
│           ├── sessions.ts   ← GET/POST /api/sessions, GET /:id/messages, DELETE /:id
│           ├── events.ts     ← GET /api/events — app-level SSE (reload, notifications)
│           └── admin.ts      ← POST /api/admin/reload, GET /api/admin/version
│
├── client/                   ← Vite 6 + React 19
│   ├── package.json
│   ├── vite.config.ts        ← proxy /api → :3001, build → ../server/public
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── index.css         ← dark theme, all styles
│       ├── App.tsx           ← root layout, session state, delete handler, reload overlay
│       ├── lib/
│       │   └── api.ts        ← fetch wrappers, fetch-based SSE client, subscribeToAppEvents
│       └── components/
│           ├── SessionSidebar.tsx  ← session list, new button, delete button
│           ├── ChatWindow.tsx      ← message history load, streaming deltas, stop
│           ├── MessageBubble.tsx   ← markdown via marked, syntax via highlight.js
│           └── MessageInput.tsx    ← textarea, Send / Stop button
│
└── safe/                     ← ⚠️ FROZEN emergency terminal (see self-management.md)
    ├── server.js             ← plain Node.js HTTP server, zero dependencies
    ├── index.html            ← vanilla JS UI, red theme
    └── package.json          ← { "type": "module" }
```

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Server runtime | Node.js 23 (ESM) | Built-in `node:sqlite`; no native addon compile issues |
| Server framework | Express 5 | Minimal, well-typed |
| Database | `node:sqlite` (built-in) | `better-sqlite3` fails on Node 23 (V8 ABI mismatch) |
| AI engine | `claude` CLI subprocess | Full Claude Code capabilities without SDK limitations |
| Client bundler | Vite 6 | Fast HMR, straightforward proxy config |
| UI framework | React 19 | Future path to React Native packaging |
| Markdown | `marked` | Lightweight, synchronous parse |
| Syntax highlight | `highlight.js` | Post-render, targets `pre code` blocks |
| Dev runner | `tsx watch` | Hot-reload TypeScript without a separate compile step |

---

## Request Flow

### Sending a message

```
Browser (React)
  │  POST /api/chat  { sessionId, message }
  │  Authorization: Bearer <API_KEY>
  ▼
Express (chat.ts)
  │  1. Validate body + auth
  │  2. Look up session in SQLite
  │  3. If first message: generate title, update DB, queue SSE title event
  │  4. Insert user message into messages table
  │  5. Set SSE headers, call res.flushHeaders()
  │  6. Emit  event: title  (if new session)
  │  7. spawnClaude(message, claudeSessionId?, res, signal, onComplete)
  ▼
claude CLI subprocess (process.ts)
  │  args: --print <msg> --output-format stream-json --verbose
  │        --include-partial-messages [--resume <claude_session_id>]
  │  env:  all CLAUDE* vars stripped; CI=true; stdin closed
  │
  │  stdout lines (NDJSON) → readline → parsed
  │    system.init   → extract session_id, call onSessionId(), store in DB
  │    stream_event  → accumulate text delta; forward as  event: chunk
  │    result        → call onComplete(accumulatedText), forward as  event: chunk
  │                    then  event: done, close res
  ▼
Express (chat.ts) — onComplete callback
  │  Insert assistant message into messages table
  ▼
Browser SSE reader (api.ts)
  │  fetch() with ReadableStream (not EventSource — needs auth header)
  │  Manual SSE line parser: event: / data: pairs
  │    title chunk  → onTitle()  → App updates sidebar title in state
  │    chunk        → filter content_block_delta → onTextDelta()
  │    done         → onDone()
  │    error        → onError()
  ▼
ChatWindow / MessageBubble
  │  Appends delta to assistant message content
  │  marked.parse() re-runs on each update
  │  highlight.js runs on new pre code blocks after render
```

### Stop / cancel

```
User clicks Stop
  → client: cancelRef.current() → AbortController.abort() → fetch cancelled
  → server: res.on('close') fires → abortController.abort()
  → process.ts: signal 'abort' listener → child.kill('SIGTERM')
```

### Session lifecycle

```
POST /api/sessions
  → creates row: { id: uuid, title: "New Chat", claude_session_id: null }

First message in session:
  → title updated to truncated message text (≤40 chars, word boundary)
  → title SSE event emitted immediately (before first token)
  → user message inserted into messages table
  → after system.init chunk: claude_session_id stored
  → after result chunk: assistant message inserted into messages table

Subsequent messages:
  → --resume <claude_session_id> passed to CLI
  → Claude maintains full conversation context internally

Opening a past session:
  → GET /api/sessions/:id/messages
  → ChatWindow renders full history before any new input
```

---

## Configuration

All config lives in `.env` at the monorepo root.

| Variable | Default | Description |
|---|---|---|
| `API_KEY` | — | Bearer token; required. Set in both `.env` and `client/.env.local` as `VITE_API_KEY` |
| `PORT` | `3001` | Main server port |
| `SAFE_PORT` | `3003` | Safe-mode server port |
| `DATABASE_PATH` | `server/steward.db` | Optional override for the SQLite file path (absolute or cwd-relative). Defaults to `server/steward.db` via a file-location-based fallback in `db/index.ts`. |
| `NODE_ENV` | `development` | `production` enables static file serving and disables CORS |
| `CLAUDE_PATH` | `~/.local/bin/claude` | Absolute path to the `claude` CLI binary |

`dotenv` is loaded in `server/src/index.ts` with an explicit path (`../../.env` from `server/src/`) before any `process.env` access.

The client reads `VITE_API_KEY` from `client/.env.local` at build time via `import.meta.env`.

---

## Database Schema

Current tables in `steward.db` (WAL mode):

```sql
CREATE TABLE sessions (
  id                TEXT PRIMARY KEY,       -- server UUID, exposed to client
  title             TEXT NOT NULL DEFAULT 'New Chat',
  claude_session_id TEXT,                   -- from CLI's system.init chunk; used for --resume
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
)

CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role       TEXT NOT NULL,                 -- 'user' | 'assistant'
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)
```

The two-ID session design separates concerns: `id` is a stable client-facing identifier; `claude_session_id` is an opaque CLI handle that only exists after the first message completes initialization.

**Upcoming (projects milestone):** a `projects` table (`id`, `name`, `path`) will be added and `sessions` will gain a `project_id` FK. The `messages` table references only `session_id` and requires no changes.

---

## SSE Protocol

The `/api/chat` endpoint is a persistent SSE stream. Events emitted in order:

| Event | Data | When |
|---|---|---|
| `title` | `{ title: string }` | First message only; emitted before any claude output |
| `chunk` | Raw claude NDJSON object | Every line from claude stdout |
| `done` | `{ session_id: string }` | After claude `result` chunk; server closes response |
| `error` | `{ message: string }` | On spawn error or non-zero exit |

The client uses `fetch()` + `ReadableStream` instead of `EventSource` because `EventSource` does not support custom request headers (needed for `Authorization: Bearer`).

---

## Critical: claude CLI Subprocess Gotchas

These bugs are non-obvious and cost significant debugging time:

**1. `CLAUDECODE=1` causes hanging**
When spawned from inside a Claude Code session, the child inherits `CLAUDECODE=1`. This makes the child wait indefinitely for IPC from a parent session that never responds. Fix: strip all env vars starting with `CLAUDE` before spawning. The child authenticates via `~/.claude/` credentials instead.

**2. `CI=true` is required for pipe output**
`--output-format stream-json --verbose` suppresses all output when stdout is a pipe (TTY detection). Fix: always set `CI=true` in the spawn environment.

**3. Close stdin**
Use `stdio: ['ignore', 'pipe', 'pipe']`. Without `'ignore'`, claude may block waiting for stdin input.

**4. `req.on('close')` fires too early**
Express fires `req.on('close')` when the request body is fully consumed by `express.json()` middleware — not when the client disconnects. Fix: use `res.on('close')` for SSE cleanup.

**5. No `assistant` chunk fallback**
With `--include-partial-messages`, the `stream_event.content_block_delta` chunks deliver text token-by-token. The final `assistant` chunk contains the full accumulated text. Reading both causes duplicate content. Fix: only handle `content_block_delta`; ignore the `assistant` chunk.

---

## Development

```bash
cp .env.example .env          # fill in API_KEY and CLAUDE_PATH
echo "VITE_API_KEY=<same key>" > client/.env.local

npm install
npm run dev                   # starts server :3001 + client :5173 concurrently
```

## Testing

Three tiers, all requiring only `npm install` to set up:

```bash
npm test                      # Tier 1+2: server integration tests + client component tests (fast, no Claude needed)
npm run test:e2e              # Tier 3: Playwright E2E smoke tests (requires dev servers running or starts them)
npm run test:all              # All three tiers in sequence
```

| Tier | Tool | What it covers |
|---|---|---|
| Server integration | Vitest + supertest | Auth, project CRUD, path traversal security, session scoping, SSE chat stream (Claude mocked) |
| Client components | Vitest + RTL + msw | ProjectPicker, SessionSidebar, FileTree — interaction and rendering |
| E2E smoke | Playwright (Chromium) | App loads, project picker, session creation — no Claude required |

**AI feedback loop**: Claude runs `npm test` after making changes. Tests are isolated (in-memory SQLite per file, msw for API mocking), fast (~4s total for unit tests), and produce actionable failure messages. The Claude subprocess is mocked in server tests so no real API calls are made.

The Vite dev server proxies `/api/*` to `localhost:3001`, so the client makes all requests to its own origin.

## Production Build

```bash
npm run build   # client → server/public/, then tsc for server
npm start       # node dist/index.js — serves static files + API on one port
```

In production, Express serves `server/public/index.html` for all non-API routes.
