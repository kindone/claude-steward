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

### Core UX
- [x] **Session reordering** — move active session to top on new message
- [x] **Edit session title** — inline rename (double-click); `PATCH /api/sessions/:id`
- [x] **Copy message button** — copy-to-clipboard on assistant bubbles
- [x] **Keyboard shortcuts** — `Cmd+N` new session, `Cmd+[` / `Cmd+]` prev/next session
- [ ] **File navigation prominence** — once a session is active, file management should be more prominent; discuss layout options (e.g. persistent file panel, top-level tab, or resizable split between files and sessions)

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
- [ ] **Dual-mode setup** — run dev and production simultaneously on the same EC2 instance without conflict; dev server moves from `:3001` → `:3002` (set `PORT=3002` in `ecosystem.dev.config.cjs`); Vite proxy target made configurable via `API_PORT` env var (currently hardcoded to `:3001`); `scripts/up.js` and `scripts/status.js` updated to include `:3002` in dev port list
- [ ] **Dev subdomain** — `dev.steward.jradoo.com` → nginx → `:5173` (Vite dev server); A record + Let's Encrypt cert; allows both domains live simultaneously: stable prod at `steward.jradoo.com`, active dev at `dev.steward.jradoo.com`
- [ ] **Separate dev database** — set `DATABASE_PATH=./server/steward-dev.db` in `ecosystem.dev.config.cjs` and `DATABASE_PATH=./server/steward.db` in `ecosystem.config.cjs`; isolates dev sessions/projects from production; dev DB can be freely wiped/reset without touching prod; migrations naturally run on dev DB first
- [ ] **Production deploy workflow** — once dual-mode is live: develop + test on `dev.steward.jradoo.com` → `npm run build` → `POST /api/admin/reload` updates `steward.jradoo.com` without touching dev mode; production nginx upstream stays on `:3001` permanently

### Self-management
- [ ] **Steward-as-project** — add the steward repo itself as a project in the UI once the projects milestone is done

### Safe Core
- [ ] **Extending safe core** — discuss splitting into multiple focused safe-cores: current one stays as the Claude Code emergency interface; a second could expose read-only DB queries (session/project browser); further cores could cover other admin tasks. Consider shared port-allocation convention and a lightweight process registry.

### Permissions
- [ ] **Fine-grained tool permissions per session** — the current Plan/Edit/Full triad is coarse. Explore `--allowedTools` / `--disallowedTools` CLI flags (support patterns like `Bash(npm:*)`) to allow command-level whitelists and blacklists. Possible UX: an "Advanced" mode in the session header that exposes an editable allowed-tools list, stored as `allowed_tools TEXT` on the sessions row and passed via `--allowedTools` at spawn time.

### Auth & Security
- [x] **HTTPS** — nginx reverse proxy on the EC2 instance; Let's Encrypt cert via certbot for both `steward.jradoo.com` (→ `:5173` dev / `:3001` prod) and `safe.steward.jradoo.com` (→ `:3003`); `http → https` redirect; auto-renewing
- [ ] **Passkeys (WebAuthn)** — replace shared `API_KEY` with device-bound passkey auth; `@simplewebauthn/server` + `@simplewebauthn/browser`; server stores credential IDs + public keys in DB; issues a session cookie after successful assertion; safe-mode retains its own independent auth (separate from main app); prerequisite: HTTPS
- [ ] **Remove `VITE_API_KEY` from build** — currently the API key is baked into the JS bundle at build time; once Passkeys land, client auth is cookie-based and no secrets live in the bundle

### Testing
- [ ] **Migration unit tests** — cover the three startup scenarios in Vitest: (1) fresh DB → `seedStewardProject` creates the project with correct name/path; (2) existing DB with orphaned sessions → `migrateOrphanedSessions` reassigns them; (3) existing DB with steward project already present → both functions are true no-ops (no duplicates). Each test gets its own `DATABASE_PATH` temp file via the existing `setup.ts` pattern.
- [ ] **Fresh-install integration test** — container or isolated-directory smoke test that simulates a real first-run: clone (or copy) the repo, create a minimal `.env`, run `npm install && npm start`, then assert: steward project present in `GET /api/projects`, server returns 200 on `/api/meta`, safe-mode reachable on `:3003`. Candidate approaches: a `Dockerfile.test` (most hermetic) or a GitHub Actions job on a clean runner with no pre-existing DB.

### Packaging
- [ ] **Capacitor shell** — thin native wrapper (iOS + Android + desktop) using Capacitor's remote URL mode pointing at the server; `mobile/` package in monorepo with `capacitor.config.ts`; no bundled assets — always loads from server URL
