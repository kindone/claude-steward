# Claude Steward — TODO

Tasks are grouped by status and roughly ordered by priority within each group.

---

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
- [x] **Stop/cancel streaming** — Stop button in `MessageInput`; `AbortController` on client fetch; `SIGTERM` on child process; `signal?: AbortSignal` in `SpawnOptions`
- [x] **Message persistence** — `messages` table in SQLite; user + assistant messages inserted on send/complete; `GET /api/sessions/:id/messages`; history loaded in `ChatWindow` on mount
- [x] **Delete sessions** — `DELETE /api/sessions/:id`; cascade-delete messages; delete button in sidebar (hover, with confirm)

---

## Planned

### Projects milestone (next sprint)
- [ ] **`projects` table** — `id`, `name`, `path` (server directory), `created_at`; add `project_id` FK to `sessions`
- [ ] **Project switcher UI** — list projects in sidebar header; create project (name + server path); switch active project
- [ ] **Session scoping** — sessions list filtered by active project; new sessions inherit project `path` as `--cwd` for claude
- [ ] **File system navigation** — simple tree view browsing the project's `path`; file open/view to start

### Mini-App Platform
- [ ] **`steward-app.json` manifest spec** — `name`, `type`, `devCommand`, `port`, `buildCommand`; the pluggable contract that makes any project embeddable
- [ ] **Sidecar process manager** — spawn/stop/restart mini-app processes per project; `GET /api/projects/:id/app/status`, `POST /api/projects/:id/app/start|stop`
- [ ] **Split-panel UI** — resizable divider; iframe embed of running mini-app; collapse/expand to full-screen
- [ ] **Project templates** — starters for `docs` (MkDocs-style), `notebook` (live code cells + output), `webapp` (Vite + React + Leaflet for travel-type apps)
- [ ] **Claude as app maker** — scaffold new mini-apps via chat, modify files, trigger live-reload via sidecar manager

### Core UX
- [ ] **Session reordering** — move active session to top of list on each new message (`updated_at` already tracked)
- [ ] **Edit session title** — inline rename in sidebar (double-click or pencil icon); `PATCH /api/sessions/:id`
- [ ] **Copy message button** — copy-to-clipboard on assistant bubbles
- [ ] **Keyboard shortcuts** — `Cmd+N` new session, `Cmd+[` / `Cmd+]` prev/next session

### Scheduler
- [ ] **Scheduled conversation resume** — `schedules` table (`id`, `session_id`, `cron`, `prompt_context`, `enabled`); `node-cron` runner injects context-aware wake messages ("would you like to resume the conversation about X?")
- [ ] **Push notifications** — FCM / web push to registered devices; fires when scheduler produces output while browser is closed
- [ ] **Scheduler UI** — list/create/toggle schedules; associate with a session; set reminder text

### Tools / Skills
- [ ] **File-based tools** — scripts in a project directory registered as Claude tools; run server-side with user-granted permissions
- [ ] **System prompt per session** — optional text injected before every message; stored in `sessions` table; UI to set it
- [ ] **MCP support** — pass `--mcp-config <path>` to spawn args; `mcp_configs` table per project; UI to manage JSON configs

### Integrations
- [ ] **Amazing Marvin** — scheduled session that pulls tasks from Marvin API, summarizes via Claude, pushes updates back

### Self-management
- [ ] **Safe-mode core** — `safe/server.js` (~120 lines plain JS, zero deps) + `safe/index.html` (vanilla JS, red theme); separate PM2 process on `:3003`; frozen after stabilization
- [ ] **App-level SSE stream** — `GET /api/events`; `server/src/lib/connections.ts` registry (`Set<Response>`); `broadcastEvent()` helper
- [ ] **Reload endpoint** — `POST /api/admin/reload`; broadcast `event: reload` to all app connections; `process.exit(0)`; `GET /api/admin/version` (startup timestamp)
- [ ] **Client reload handler** — `subscribeToAppEvents()` in `api.ts` with auto-reconnect; "Restarting…" overlay in `App.tsx`; `window.location.reload()` after 1.5s
- [ ] **PM2 ecosystem config** — `ecosystem.config.cjs`; `steward-main` + `steward-safe` processes
- [ ] **Steward-as-project** — add the steward repo itself as a project in the UI once the projects milestone is done

### Packaging
- [ ] **Mobile wrapper** — React Native / Flutter thin shell (Capacitor or Expo WebView) once feature set stabilizes
