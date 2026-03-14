# Claude Steward — Archived TODO

## Done

- [x] **MVP: monorepo scaffold** — npm workspaces, `server/` + `client/`, `concurrently` dev script
- [x] **Express server** — auth middleware, CORS, dotenv with explicit root path, prod static serving
- [x] **SQLite sessions** — `node:sqlite` (built-in), WAL mode, two-ID session design (`id` + `claude_session_id`)
- [x] **Claude CLI subprocess** — `stream-json --verbose --include-partial-messages`, env cleanup (`CLAUDE*` stripped, `CI=true`), stdin closed
- [x] **SSE streaming endpoint** — `POST /api/chat`, `res.flushHeaders()`, `res.on('close')` cleanup
- [x] **Fetch-based SSE client** — manual line parser (not `EventSource`); handles `chunk`, `done`, `error` events
- [x] **Session continuity** — `--resume <claude_session_id>` on subsequent messages
- [x] **Markdown + syntax highlight** — `marked` + `highlight.js` in `MessageBubble`; streaming cursor blink
- [x] **Session sidebar** — list + new session button; `key={activeSessionId}` on `ChatWindow` for clean resets
- [x] **Auto-generated session titles** — truncated first message (≤40 chars, word boundary); DB update + `title` SSE event; sidebar updates before first token
- [x] **architecture.md** — repo structure, request flow diagrams, config reference, SSE protocol, claude CLI gotchas, planned features
- [x] **Safe-mode core** — `safe/server.js` (zero deps, plain Node.js) + `safe/index.html` (vanilla JS, red theme, tool-activity display); separate PM2 process on `:3003`; frozen after stabilization
- [x] **App-level SSE stream** — `GET /api/events`; `server/src/lib/connections.ts` registry (`Set<Response>`); `broadcastEvent()` helper
- [x] **Reload endpoint** — `POST /api/admin/reload`; broadcasts `event: reload` to all app connections; `process.exit(0)`; `GET /api/admin/version`
- [x] **Client reload handler** — `subscribeToAppEvents()` in `api.ts` with auto-reconnect; "Restarting…" overlay in `App.tsx`; `window.location.reload()` after 1.5s
- [x] **PM2 ecosystem config** — `ecosystem.config.cjs`; `steward-main` (:3001, restartable) + `steward-safe` (:3003, frozen)
- [x] **Projects milestone** — `projects` table + `project_id` FK on `sessions`; CRUD API (`/api/projects`); file listing + content endpoints with path traversal guard; project switcher in sidebar (dropdown picker, create/delete); session scoping by project; `--cwd` passed to claude spawn; collapsible file tree with directory expand and file viewer modal
- [x] **Stop/cancel streaming** — Stop button in `MessageInput`; `AbortController` on client fetch; `SIGTERM` on child process; `signal?: AbortSignal` in `SpawnOptions`
- [x] **Message persistence** — `messages` table in SQLite; user + assistant messages inserted on send/complete; `GET /api/sessions/:id/messages`; history loaded in `ChatWindow` on mount
- [x] **Delete sessions** — `DELETE /api/sessions/:id`; cascade-delete messages; delete button in sidebar (hover, with confirm)
