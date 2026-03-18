# Claude Steward — TODO

Canonical task list. Completed items → `archived_tasks.md`. Bugs → `BUGS.md`. Milestone context → `docs/roadmap.md`.

---

## Planned

### Mini-App Platform
- [ ] **`steward-app.json` manifest spec** — `name`, `type`, `devCommand`, `port`, `buildCommand`; the pluggable contract that makes any project embeddable
- [ ] **Sidecar process manager** — spawn/stop/restart mini-app processes per project; `GET /api/projects/:id/app/status`, `POST /api/projects/:id/app/start|stop`
- [ ] **Split-panel UI** — resizable divider; iframe embed of running mini-app; collapse/expand to full-screen
- [ ] **Project templates** — starters for `docs` (MkDocs-style), `notebook` (live code cells + output), `webapp` (Vite + React + Leaflet for travel-type apps)
- [ ] **Claude as app maker** — scaffold new mini-apps via chat, modify files, trigger live-reload via sidecar manager

### Scheduler
- [ ] **Scheduled conversation resume** — `schedules` table (`id`, `session_id`, `cron`, `prompt_context`, `enabled`); `node-cron` runner injects context-aware wake messages ("would you like to resume the conversation about X?")
- [ ] **Push notifications (scheduler)** — extend the existing push infrastructure to fire when a scheduled session produces output; also consider a per-session opt-in so Claude reply notifications can be toggled per session rather than globally
- [ ] **Scheduler UI** — list/create/toggle schedules; associate with a session; set reminder text

### Auth
- [ ] **New device passkey login** — new-device bootstrapping: a device with no registered passkey and no iCloud/Google sync has no way to authenticate; needs a one-time invite link or similar mechanism. (RP ID mismatch fixed; "user verification required" error tracked in `BUGS.md`.)

### Sessions & Projects
- [ ] **Per-project system prompt** — add `system_prompt TEXT` to the `projects` table; project settings UI to set it; new sessions under a project pre-populate `session.system_prompt` from the project default (session-level still overrides); follows existing `ALTER TABLE` migration pattern
- [ ] **Persist error messages to DB** — when `onError` fires in `chat.ts`, insert an assistant message with the error text so it survives a page reload. Requires a way to mark a message as an error (e.g. `is_error BOOLEAN` column or a sentinel role) so `MessageBubble` can render it as an error bubble rather than plain content. Also extend `notifyWatchers` / the watch SSE to carry an error signal so reloaded tabs can distinguish "Claude errored" from "still running". Tracked as a bug in `BUGS.md` (Interrupted session handling).

### Core UX
- [x] **Chat input persistence** — draft saved to `localStorage` keyed by `steward:draft:<sessionId>`, restored on mount, cleared on send; 400ms debounce on input.
- [x] **Favicon** — `favicon.svg` (🧭 on blue background) added to `client/public/`; `index.html` updated with icon/apple-touch-icon/theme-color meta; `sw.js` updated to use `/favicon.svg` instead of missing `/icon-192.png`
- [ ] **Rich chat content rendering** — several rendering gaps to close (XSS sanitization tracked separately in `BUGS.md`):
  - **Mermaid diagrams**: detect fenced ` ```mermaid ` blocks and render via `mermaid.js`; Claude generates these frequently
  - **Image rendering**: project-relative image paths in markdown (e.g. `![](./output.png)`) should resolve via the file binary endpoint so Claude-generated images display inline
  - **Sandboxed HTML preview**: when Claude produces a standalone HTML artifact, render in a sandboxed `<iframe srcdoc>` with source/preview toggle
  - **Math / LaTeX** (lower priority): KaTeX rendering for `$...$` and `$$...$$` blocks

### Push Notifications (hardening)
- [ ] **Push notification improvements** — (send bugs tracked in `BUGS.md`); remaining feature gaps:
  - No per-session or per-user targeting (all subscribers get all notifications); prerequisite for the scheduler per-session opt-in
  - iOS requires "Add to Home Screen" with no in-app guidance; add a dismissible install prompt or at least a tooltip on the bell icon

### Workspace / Files
- [ ] **File upload / download** — download button per file in the file browser (binary endpoint already exists, just needs UI); upload via drag-and-drop or file picker into a selected directory (`POST /api/projects/:id/files/upload` multipart endpoint + tree UI entry point); v2: attach a file to a chat message so Claude can work with it directly
- [ ] **MCP support** — pass `--mcp-config <path>` to spawn args; `mcp_configs` table per project; UI to manage JSON configs

### Integrations
- [ ] **Amazing Marvin** — scheduled session that pulls tasks from Marvin API, summarizes via Claude, pushes updates back

### Dev / Production Workflow
- [ ] **Production deploy workflow** — develop + test on `dev.steward.jradoo.com` → `npm run build` → `POST /api/admin/reload` hot-reloads `steward.jradoo.com`; document and wire up the build step so deploying is a single command
- [ ] **Environment switcher UI** — floating toggle (authenticated users only) to navigate between `steward.jradoo.com` (prod) and `dev.steward.jradoo.com` (dev); consider long-press on header to avoid accidental switches; works in Capacitor WebView too

### Operational Reliability
- [ ] **Granular tier scripts** — split `down` / `restart` / `logs` by tier so a single command can only affect one at a time: `down:dev`, `down:prod`, `down:safe`, `restart:dev`, `restart:prod`, `logs:dev`, `logs:prod`; bulk `down` / `restart` should warn and require `--force`; `safe` must never be killed by a bulk command
- [ ] **Enhanced `npm run status`** — extend beyond port checks to cover: PM2 process names + states, required env vars present (`APP_DOMAIN`, `VAPID_PUBLIC_KEY`), nginx `proxy_pass` targets match expected ports, live nginx config matches repo copy (`config/nginx-*.conf`), `server/public/` freshness for prod, TLS cert expiry days
- [ ] **External health monitor** — GitHub Actions scheduled workflow (every 5 min) that `curl`s all three public URLs (`steward`, `dev.steward`, `safe.steward`) and sends a push notification on failure; catches EC2-level and nginx-level outages that an on-server check cannot
- [ ] **Server startup env validation** — on boot, log a loud structured warning (not a crash) for each missing or suspicious config value: `APP_DOMAIN` absent or placeholder, VAPID keys absent, DB path not writable; surfaces silent misconfigs before a user hits them

### Safe Core
- [ ] **Extending safe core** — discuss splitting into multiple focused safe-cores: current one stays as the Claude Code emergency interface; a second could expose read-only DB queries (session/project browser); further cores could cover other admin tasks. Consider shared port-allocation convention and a lightweight process registry.

### Permissions
- [ ] **Fine-grained tool permissions per session** — the current Plan/Edit/Full triad is coarse. Explore `--allowedTools` / `--disallowedTools` CLI flags (support patterns like `Bash(npm:*)`) to allow command-level whitelists and blacklists. Possible UX: an "Advanced" mode in the session header that exposes an editable allowed-tools list, stored as `allowed_tools TEXT` on the sessions row and passed via `--allowedTools` at spawn time.

### Testing
- [ ] **Migration unit tests** — cover the three startup scenarios in Vitest: (1) fresh DB → `seedStewardProject` creates the project with correct name/path; (2) existing DB with orphaned sessions → `migrateOrphanedSessions` reassigns them; (3) existing DB with steward project already present → both functions are true no-ops (no duplicates). Each test gets its own `DATABASE_PATH` temp file via the existing `setup.ts` pattern.
- [ ] **Fresh-install integration test** — container or isolated-directory smoke test that simulates a real first-run: clone (or copy) the repo, create a minimal `.env`, run `npm install && npm start`, then assert: steward project present in `GET /api/projects`, server returns 200 on `/api/meta`, safe-mode reachable on `:3003`. Candidate approaches: a `Dockerfile.test` (most hermetic) or a GitHub Actions job on a clean runner with no pre-existing DB.

### Packaging
- [ ] **Capacitor shell** — thin native wrapper (iOS + Android + desktop) using Capacitor's remote URL mode pointing at the server; `mobile/` package in monorepo with `capacitor.config.ts`; no bundled assets — always loads from server URL
