# Claude Steward — Architecture

---

## Vision

Claude Steward is a self-hosted, always-on Claude Code environment accessible from anywhere — desktop and mobile. It is not a Claude.ai clone; it is a remotely deployed personal agent platform.

**Project-centric**: a "project" is a directory on the server. Sessions belong to a project; Claude Code runs with that directory as its working root. Multiple projects, multiple sessions per project. A file system navigation UI allows browsing and managing files within a project from the web interface.

**Remote-first**: intended to run on a machine you control (VPS, home server, etc.) — not just localhost. Any device with a browser can access it.

**Proactive scheduler**: conversations can be scheduled to resume later. "Remind me tomorrow evening about this" → a meta-agent stores the intent in SQLite, fires via `node-cron`, sends a push notification, and injects a context-aware wake message ("would you like to resume the conversation about X as you said yesterday?").

**Mini-app platform**: projects can be "living artifacts" — embeddable web apps that Claude builds and maintains alongside the chat. Each mini-app declares a `steward-app.json` manifest (`name`, `type`, `devCommand`, `port`). The Steward spawns them as sidecar processes and embeds them via iframe in a split-panel view (chat left, app right; collapsible to full-screen). Standard types:
- `docs` — MkDocs-style or custom book renderer; Claude generates markdown, build pipeline renders it
- `notebook` — Observable-style live code cells + visualizations; great for data exploration and analysis
- `webapp` — fully custom app Claude scaffolds and populates (e.g., "Rome Hotels": map pins, hotel comparisons, photos, directions, price aggregation from multiple sources)

Claude can scaffold mini-apps from templates or generate them freeform. The `steward-app.json` manifest is the pluggable contract that makes any project embeddable regardless of its tech stack.

**Extensible tools/skills**: file-based scripts in a project directory that Claude can execute, subject to user-granted permissions. New tools are added by writing a file; no server restart required.

**Self-managing**: the steward app itself is one of its own projects. Claude edits source files via chat, runs `npm run build`, then calls `POST /api/admin/reload`. The server broadcasts a `reload` SSE event to all connected browsers, waits 200ms, and calls `process.exit(0)`. PM2/systemd restarts it with the new `dist/`. Clients show a brief "Restarting…" overlay and reload after 1.5s.

**Safe-mode core**: a frozen, dependency-free emergency terminal in `safe/`. A ~150-line plain Node.js HTTP server + single vanilla-JS HTML page that provides direct `claude` CLI access on port `:3003`. No React, no TypeScript, no build step. Runs as a separate PM2 process that is never part of the upgrade cycle. Once stabilized, `safe/` is never modified again — it is the last-resort tool for recovering from a broken main app.

---

## Repository Structure

```
claude-steward/               ← npm workspace root
├── package.json              ← workspace config, concurrently dev script
├── .env                      ← secrets (gitignored)
├── .env.example              ← committed template
├── architecture.md           ← this file
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
│       └── routes/
│           ├── chat.ts       ← POST /api/chat — SSE streaming, message persistence, AbortController
│           └── sessions.ts   ← GET/POST /api/sessions, GET /:id/messages, DELETE /:id
│
└── client/                   ← Vite 6 + React 19
    ├── package.json
    ├── vite.config.ts        ← proxy /api → :3001, build → ../server/public
    ├── index.html
    └── src/
        ├── main.tsx
        ├── index.css         ← dark theme, all styles
        ├── App.tsx           ← root layout, session state, delete handler
        ├── lib/
        │   └── api.ts        ← fetch wrappers, fetch-based SSE client
        └── components/
            ├── SessionSidebar.tsx  ← session list, new button, delete button
            ├── ChatWindow.tsx      ← message history load, streaming deltas, stop
            ├── MessageBubble.tsx   ← markdown via marked, syntax via highlight.js
            └── MessageInput.tsx    ← textarea, Send / Stop button
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
| `PORT` | `3001` | Server port |
| `DATABASE_PATH` | `./steward.db` | SQLite file path, relative to server working directory |
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

The Vite dev server proxies `/api/*` to `localhost:3001`, so the client makes all requests to its own origin.

## Production Build

```bash
npm run build   # client → server/public/, then tsc for server
npm start       # node dist/index.js — serves static files + API on one port
```

In production, Express serves `server/public/index.html` for all non-API routes.

---

## Self-Management & Safe-Mode

### Upgrade flow

```
Claude (in steward project session):
  1. Edits source files via chat
  2. Runs: npm run build
  3. Build succeeds → calls POST /api/admin/reload
  ↓
Server (admin.ts):
  1. Broadcasts  event: reload  to all /api/events connections
  2. Waits 200ms
  3. process.exit(0)
  ↓
PM2:
  Detects clean exit → restarts node dist/index.js with new code
  ↓
Clients (having received reload event):
  Show "Restarting…" overlay
  setTimeout(() => window.location.reload(), 1500)
  → reconnect to the new version
```

### App-level SSE stream (`/api/events`)

Separate from the chat SSE stream. The `App` component connects on mount and holds this connection open for the lifetime of the browser session. The server tracks all connections in `server/src/lib/connections.ts` (`Set<Response>`). Used for:
- `reload` events (upgrade flow)
- Future: scheduler notifications, background job status

### Safe-mode core (`safe/`)

A completely independent emergency terminal. Properties:
- **Separate PM2 process** on port `:3003` — survives main app crashes
- **Zero dependencies** — pure Node.js built-ins (`http`, `child_process`, `readline`)
- **No build step** — runs directly with `node safe/server.js`
- **Stateless** — no database; client holds `claudeSessionId` in JS state for session continuity
- **Distinct UI** — red/orange theme with "⚠ SAFE MODE" banner; unmistakably not the main app
- **Auth** — same `API_KEY` bearer token

**`safe/` is frozen once stabilized.** It must never be modified, never included in build scripts, and never touched by Claude sessions. Its value is precisely that it is not subject to the upgrade cycle.

```
PM2 ecosystem:
  steward-main  (node dist/index.js)   port 3001  ← upgraded via /api/admin/reload
  steward-safe  (node safe/server.js)  port 3003  ← frozen, always-on
```

---

## Planned Features (roadmap)

### Projects milestone
- **`projects` table** — `id`, `name`, `path` (server directory), `created_at`; `project_id` FK added to `sessions`
- **Project switcher UI** — list projects in sidebar header; create project (name + server path); switch active project
- **Session scoping** — sessions list filtered by active project; new session inherits project's `path` as `--cwd` for claude
- **File system navigation** — simple tree view browsing the project's `path`; file open/view to start

### Mini-App Platform
- **`steward-app.json` manifest spec** — `name`, `type`, `devCommand`, `port`, `buildCommand`; the pluggable contract for embeddable projects
- **Sidecar process manager** — server-side: spawn/stop/restart mini-app processes per project; `GET /api/projects/:id/app/status`, `POST /api/projects/:id/app/start|stop`
- **Split-panel UI** — resizable divider; iframe embed of running mini-app; collapse/expand to full-screen
- **Project templates** — starters for `docs` (MkDocs or custom), `notebook` (live code cells + output), `webapp` (Vite + React + Leaflet/maps for travel-type apps)
- **Claude as app maker** — scaffold new mini-apps via chat, modify files, trigger live-reload via sidecar manager

### Core UX
- **Session reordering** — move active session to top of list on each new message (`updated_at` already tracked)
- **Edit session title** — inline rename in sidebar (double-click or pencil icon); `PATCH /api/sessions/:id`
- **Copy message button** — copy-to-clipboard on assistant bubbles
- **Keyboard shortcuts** — `Cmd+N` new session, `Cmd+[` / `Cmd+]` prev/next session

### Scheduler
- **Scheduled conversation resume** — `schedules` table (`id`, `session_id`, `cron`, `prompt_context`, `enabled`); `node-cron` runner injects context-aware wake messages
- **Push notifications** — FCM / web push to registered devices; fires when scheduler produces output while browser is closed
- **Scheduler UI** — list/create/toggle schedules; associate with a session; set reminder text

### Tools / Skills
- **File-based tools** — scripts in a project directory registered as Claude tools; run server-side with user-granted permissions
- **System prompt per session** — optional text injected before every message; stored in `sessions` table
- **MCP integration** — pass `--mcp-config` to spawn args; `mcp_configs` table per project; UI to manage JSON configs

### Integrations
- **Amazing Marvin** — scheduled session that pulls tasks from Marvin API, summarizes via Claude, pushes updates back

### Self-management
- **Safe-mode core** — `safe/server.js` + `safe/index.html`; frozen plain-JS emergency terminal on `:3003`; separate PM2 process; never touched after stabilization
- **App-level SSE stream** — `GET /api/events`; `server/src/lib/connections.ts` registry; client connects on mount for reload events and future push notifications
- **Reload endpoint** — `POST /api/admin/reload`; broadcasts `event: reload` to all app connections, then `process.exit(0)`; PM2 restarts with new `dist/`
- **Client reload handler** — `subscribeToAppEvents()` in `api.ts`; "Restarting…" overlay in `App`; `window.location.reload()` after 1.5s
- **PM2 ecosystem config** — `ecosystem.config.cjs`; two apps: `steward-main` (:3001) restartable, `steward-safe` (:3003) independent
- **Steward-as-project** — add the steward repo as a project in the UI; Claude can edit, build, and deploy it from within the chat

### Packaging
- **Mobile wrapper** — React Native / Flutter thin shell (Capacitor or Expo WebView) once feature set stabilizes
