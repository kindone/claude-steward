# Claude Steward — TODO

Canonical task list. Completed items → `archived_tasks.md`. Milestone context → `docs/roadmap.md`.

---

## Planned

### Mini-App Platform
- [ ] **`steward-app.json` manifest spec** — `name`, `type`, `devCommand`, `port`, `buildCommand`; the pluggable contract that makes any project embeddable
- [ ] **Sidecar process manager** — spawn/stop/restart mini-app processes per project; `GET /api/projects/:id/app/status`, `POST /api/projects/:id/app/start|stop`
- [ ] **Split-panel UI** — resizable divider; iframe embed of running mini-app; collapse/expand to full-screen
- [ ] **Project templates** — starters for `docs` (MkDocs-style), `notebook` (live code cells + output), `webapp` (Vite + React + Leaflet for travel-type apps)
- [ ] **Claude as app maker** — scaffold new mini-apps via chat, modify files, trigger live-reload via sidecar manager

### Performance
- [ ] **Message pagination** — `GET /api/sessions/:id/messages` currently returns the full history in one shot; for long sessions this bloats the initial load; add `?limit=N&before=<messageId>` cursor pagination on the server; client loads the most recent N messages on mount and shows a "Load older messages" button at the top that fetches the previous page

### Core UX
- [x] **Session reordering** — move active session to top on new message
- [x] **Edit session title** — inline rename (double-click); `PATCH /api/sessions/:id`
- [x] **Copy message button** — copy-to-clipboard on assistant bubbles
- [x] **Keyboard shortcuts** — `Cmd+N` new session, `Cmd+[` / `Cmd+]` prev/next session
- [x] **File navigation prominence** — Sessions / Files tab bar in the sidebar; Files tab shows the tree auto-expanded at full height; tab state persisted to `localStorage`; collapsed toggle still available in Sessions tab for quick reference
- [ ] **Terminal access panel** — lightweight shell panel (per project) where the user can issue commands directly (e.g. `git status`, `npm test`); output streamed back via SSE or a simple exec endpoint; complements Claude sessions for quick one-off commands without involving Claude
- [x] **Tool activity indicator + history** — live blue pill shows tool name from `content_block_start`; assembled calls (with command/path detail) accumulate via `assistant` chunks; streaming indicator shows muted completed calls + active blue call; persistent fold/unfold strip under each assistant message (`▶ Bash · Read` → expands with full detail per call)
- [x] **Preserve streaming response on navigation** — if the user switches sessions or closes the page mid-stream, the in-progress assistant response is lost; server should let the Claude subprocess finish and persist the completed response to the DB even after the SSE client disconnects, so it appears when the user returns to that session
- [ ] **Stop button kills Claude on server** — clicking Stop aborts the client SSE fetch but currently leaves the Claude subprocess running; the full response gets persisted to DB anyway and re-appears on next visit, which is surprising; fix by keeping a `Map<sessionId, ChildProcess>` on the server and exposing `DELETE /api/chat/:sessionId` (or piggy-backing on `req.signal`) so Stop actually sends SIGTERM to the subprocess
- [ ] **Resume-poll ceiling too low** — the client polls every 2 s for up to 60 ticks (2 min) when returning to a session with a pending response; if Claude is still processing after 2 min the spinner stops and the user must manually reload; increase the cap or switch to a lightweight SSE "ping when done" endpoint so the UI updates the moment the response lands in the DB

### Scheduler
- [ ] **Scheduled conversation resume** — `schedules` table (`id`, `session_id`, `cron`, `prompt_context`, `enabled`); `node-cron` runner injects context-aware wake messages ("would you like to resume the conversation about X?")
- [ ] **Push notifications** — FCM / web push to registered devices; fires when scheduler produces output while browser is closed
- [ ] **Scheduler UI** — list/create/toggle schedules; associate with a session; set reminder text

### Workspace / Files
- [x] **System prompt per session** — optional text injected before every message; stored in `sessions` table; UI to set it (⚙ Prompt toggle in chat header)
- [ ] **MCP support** — pass `--mcp-config <path>` to spawn args; `mcp_configs` table per project; UI to manage JSON configs

### Integrations
- [ ] **Amazing Marvin** — scheduled session that pulls tasks from Marvin API, summarizes via Claude, pushes updates back

### Dev / Production Workflow
- [x] **Dual-mode setup** — dev server on `:3002`, prod on `:3001`; `PORT=3002` + `VITE_API_PORT=3002` in `ecosystem.dev.config.cjs`; `scripts/up.js` and `scripts/status.js` updated; both modes can run simultaneously without port conflict
- [x] **Dev subdomain** — `dev.steward.jradoo.com` → nginx (`:5173`); A record + Let's Encrypt cert via certbot; `docs/nginx-dev.steward.conf` template included
- [x] **Separate dev database** — `DATABASE_PATH` uses `path.join(__dirname, 'server/steward-dev.db')` in dev config and `steward.db` in prod config; isolates dev from production data
- [ ] **Production deploy workflow** — develop + test on `dev.steward.jradoo.com` → `npm run build` → `POST /api/admin/reload` hot-reloads `steward.jradoo.com`; document and wire up the build step so deploying is a single command
- [ ] **Environment switcher UI** — floating toggle (authenticated users only) to navigate between `steward.jradoo.com` (prod) and `dev.steward.jradoo.com` (dev); consider long-press on header to avoid accidental switches; works in Capacitor WebView too
- [x] **Per-environment last-state persistence** — `{ projectId, sessionId }` written to `localStorage` on every selection; restored on app mount (validates IDs still exist before applying); origins are naturally isolated so prod and dev each remember their own context

### Self-management
- [x] **Steward-as-project** — server auto-seeds a `claude-steward` project pointing at `APP_ROOT` on first run (idempotent); delete is protected; orphaned sessions migrated to it on startup

### Safe Core
- [ ] **Extending safe core** — discuss splitting into multiple focused safe-cores: current one stays as the Claude Code emergency interface; a second could expose read-only DB queries (session/project browser); further cores could cover other admin tasks. Consider shared port-allocation convention and a lightweight process registry.

### Permissions
- [ ] **Fine-grained tool permissions per session** — the current Plan/Edit/Full triad is coarse. Explore `--allowedTools` / `--disallowedTools` CLI flags (support patterns like `Bash(npm:*)`) to allow command-level whitelists and blacklists. Possible UX: an "Advanced" mode in the session header that exposes an editable allowed-tools list, stored as `allowed_tools TEXT` on the sessions row and passed via `--allowedTools` at spawn time.

### Auth & Security
- [x] **HTTPS** — nginx reverse proxy on the EC2 instance; Let's Encrypt cert via certbot for both `steward.jradoo.com` (→ `:5173` dev / `:3001` prod) and `safe.steward.jradoo.com` (→ `:3003`); `http → https` redirect; auto-renewing
- [x] **Passkeys (WebAuthn)** — `@simplewebauthn/server` + `@simplewebauthn/browser`; `passkey_credentials` + `auth_sessions` tables; `/api/auth/register|login/start|finish`, `/api/auth/logout`, `/api/auth/status`; `HttpOnly` session cookie issued on success; `requireAuth` middleware accepts cookie first, API key as fallback; `LoginPage` / `RegisterPage` gate the entire app UI; safe-mode retains its own independent auth
- [x] **Remove `VITE_API_KEY` from build** — bearer fallback removed from `requireAuth`; `VITE_API_KEY` stripped from client build and test config; all tests migrated to cookie auth

### Testing
- [ ] **Migration unit tests** — cover the three startup scenarios in Vitest: (1) fresh DB → `seedStewardProject` creates the project with correct name/path; (2) existing DB with orphaned sessions → `migrateOrphanedSessions` reassigns them; (3) existing DB with steward project already present → both functions are true no-ops (no duplicates). Each test gets its own `DATABASE_PATH` temp file via the existing `setup.ts` pattern.
- [ ] **Fresh-install integration test** — container or isolated-directory smoke test that simulates a real first-run: clone (or copy) the repo, create a minimal `.env`, run `npm install && npm start`, then assert: steward project present in `GET /api/projects`, server returns 200 on `/api/meta`, safe-mode reachable on `:3003`. Candidate approaches: a `Dockerfile.test` (most hermetic) or a GitHub Actions job on a clean runner with no pre-existing DB.

### Packaging
- [ ] **Capacitor shell** — thin native wrapper (iOS + Android + desktop) using Capacitor's remote URL mode pointing at the server; `mobile/` package in monorepo with `capacitor.config.ts`; no bundled assets — always loads from server URL
