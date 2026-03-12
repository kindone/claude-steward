# Claude Steward — Project Memory

## Vision

Claude Steward is a self-hosted, always-on Claude Code environment accessible from anywhere (desktop + mobile). Core properties:

- **Project-centric**: each "project" maps to a real directory on the server; Claude Code sessions work within that directory. Multiple projects, multiple sessions per project. A file system navigation UI lets you browse and work within a project's files.
- **Remote-first**: designed to run on a server you control (VPS, home server, etc.), accessible over the web from any device — like a personal cloud Claude Code.
- **Proactively scheduled**: you can ask Claude to resume a conversation at a future time ("remind me tomorrow evening"). A meta-agent stores the intent in SQLite, fires via `node-cron`, sends a push notification, and injects a context-aware wake message ("would you like to resume the conversation about X?").
- **Extensible via file-based tools/skills**: scripts you write and grant permission for Claude to execute within a project. No server restart required.
- **Mini-app platform**: projects can be "living artifacts" — embeddable web apps that Claude builds and maintains alongside the chat. Each mini-app declares a `steward-app.json` manifest (`name`, `type`, `devCommand`, `port`). The Steward spawns them as sidecar processes and embeds them via iframe in a split-panel view (chat left, app right; collapsible to full-screen). Standard types: `docs` (MkDocs-style learning material), `notebook` (Observable-style live code cells + visualizations), `webapp` (fully custom — e.g., a "Rome Hotels" travel research app with maps, photos, price comparisons). Claude can scaffold from templates or generate freeform.
- **Self-managing**: the steward app itself is one of its own projects. Claude edits source files via chat, runs `npm run build`, then calls `POST /api/admin/reload` — which broadcasts a `reload` SSE event to all connected browsers and calls `process.exit(0)`. PM2/systemd detects the clean exit and restarts with the new `dist/`. Clients receive the reload event and refresh after a 1.5s window.
- **Safe-mode core** (`safe/`): a frozen, dependency-free emergency terminal. A ~150-line plain Node.js HTTP server (`safe/server.js`) + single vanilla-JS HTML page (`safe/index.html`) that provides direct `claude` CLI access on a separate port (`:3003`). No React, no TypeScript, no build step — started by a separate PM2 process that is never part of the main upgrade cycle. **`safe/` is frozen once stabilized and must never be modified.**

### Schema roadmap note
Current schema: `sessions` + `messages`. Next milestone adds a `projects` table and `project_id` FK to `sessions`. The `messages` table references only `session_id` and will not require changes.

### safe/ is frozen
`safe/server.js` and `safe/index.html` must not be modified once stabilized. They are the last-resort recovery tool — their value comes from never being touched by the upgrade cycle. Claude sessions working on the steward project must treat `safe/` as read-only.

---

## Stack
- **Server**: Node.js 23 + TypeScript (ESM), Express 5, `node:sqlite` (built-in), `tsx watch`
- **Client**: Vite 6 + React 19, `marked`, `highlight.js`
- **Monorepo**: npm workspaces (`server/` + `client/`)
- **Dev**: server :3001, client :5173 (Vite proxy `/api` → :3001)
- **Auth**: Bearer token via `API_KEY` env var; `.env` loaded by `dotenv` in `server/src/index.ts`

## Critical: Claude CLI Spawning Fixes
When spawning `claude` CLI from Node.js server (itself running in a Claude Code session):

1. **`CLAUDECODE=1` causes hanging** — strip all vars starting with `CLAUDE` from spawn env; `ANTHROPIC_BASE_URL` stays. See `server/src/claude/process.ts`.
2. **`CI=true` is required** — without it, `stream-json --verbose` produces no output when stdout is piped.
3. **`stdio: ['ignore', 'pipe', 'pipe']`** — close stdin on spawned process.
4. **`req.on('close')` fires too early** — fires when request body is consumed, NOT on client disconnect. Use `res.on('close')` instead for SSE cleanup.
5. **`--output-format stream-json --verbose --include-partial-messages`** — all three flags needed for token-by-token streaming.
6. **No `assistant` chunk fallback** — with `--include-partial-messages`, only handle `stream_event.content_block_delta`. The final `assistant` chunk causes duplicates if also processed.

## Key File Paths
- `server/src/claude/process.ts` — claude CLI spawn, SSE pipe, session ID extraction, `onComplete` accumulator
- `server/src/routes/chat.ts` — SSE endpoint; auto-title; user + assistant message persistence; `AbortController` for stop/cancel
- `server/src/routes/sessions.ts` — `GET/POST /api/sessions`, `GET /api/sessions/:id/messages`, `DELETE /api/sessions/:id`
- `server/src/routes/events.ts` — `GET /api/events`; app-level SSE stream (reload events, future notifications)
- `server/src/routes/admin.ts` — `POST /api/admin/reload` (broadcast reload + exit), `GET /api/admin/version`
- `server/src/lib/connections.ts` — global `Set<Response>` registry for app-level SSE connections; `broadcastEvent()`
- `server/src/db/index.ts` — `node:sqlite`, WAL mode, `sessionQueries` + `messageQueries`
- `server/src/index.ts` — Express entry, dotenv config with explicit path `../../.env`
- `client/src/lib/api.ts` — fetch wrappers, fetch-based SSE client, `subscribeToAppEvents()`
- `client/src/App.tsx` — root layout, session list state, delete handler, reload overlay
- `client/src/components/ChatWindow.tsx` — loads message history on mount; streaming + stop
- `client/src/components/MessageInput.tsx` — Send / Stop button
- `client/src/components/SessionSidebar.tsx` — session list, delete button (hover)
- `safe/server.js` — ⚠️ FROZEN — plain Node.js emergency terminal server (no deps, no build)
- `safe/index.html` — ⚠️ FROZEN — vanilla JS emergency chat UI (red theme, stateless)
- `ecosystem.config.cjs` — PM2 config: `steward-main` (:3001) + `steward-safe` (:3003)
- `.env` — root level: `API_KEY`, `PORT`, `DATABASE_PATH`, `CLAUDE_PATH`, `SAFE_PORT`
- `client/.env.local` — `VITE_API_KEY` (matches `API_KEY`)
- `architecture.md` — full architecture doc (structure, flows, schema, gotchas, roadmap)
- `TODO.md` — canonical task list

## Session Design
- Server UUID (`id`) exposed to client; `claude_session_id` populated from first `system.init` chunk
- First message: no `--resume`; `claude_session_id` stored after init chunk received
- Subsequent messages: `--resume <claude_session_id>` for conversation continuity

## Auto-Title Design
- On first message (when `session.title === 'New Chat'`): truncate message text to ≤40 chars at word boundary, update DB, emit `event: title` SSE event before spawning claude
- Client `api.ts` parses `title` event → calls `onTitle?.(title)` → `ChatWindow` passes it up → `App.handleTitleUpdate` patches the session in state
- Title appears in sidebar before first token arrives

## SSE Event Protocol
Four event types from `POST /api/chat`:
1. `title` — `{ title: string }` — first message only, emitted before any claude output
2. `chunk` — raw claude NDJSON line — forwarded from claude stdout
3. `done` — `{ session_id: string }` — after `result` chunk; server closes response
4. `error` — `{ message: string }` — on spawn error or non-zero exit

## Node:sqlite Notes
- `better-sqlite3` fails to compile on Node 23 — use `node:sqlite` (built-in, experimental)
- API uses `db.prepare(sql).get(...)` / `.all()` / `.run(...)` — wrap in functions

## Launch Config
`.claude/launch.json` has both `server` (port 3001) and `client` (port 5173) configurations.
