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

### Scheduler
- [ ] **Scheduled conversation resume** — `schedules` table (`id`, `session_id`, `cron`, `prompt_context`, `enabled`); `node-cron` runner injects context-aware wake messages ("would you like to resume the conversation about X?")
- [ ] **Push notifications (scheduler)** — extend the existing push infrastructure to fire when a scheduled session produces output; also consider a per-session opt-in so Claude reply notifications can be toggled per session rather than globally
- [ ] **Scheduler UI** — list/create/toggle schedules; associate with a session; set reminder text

### Auth
- [ ] **New device passkey login** — RP ID mismatch fixed (`APP_DOMAIN` was hardcoded as `steward.example.com` in ecosystem configs, overriding `.env`; removed and now loads correctly from `.env`). Remaining: new-device bootstrapping flow (a device with no registered passkey and no iCloud/Google sync has no way to authenticate; needs a one-time invite link or similar mechanism). Also: `register/finish` was observed throwing `"User verification was required, but user could not be verified"` — investigate if this resurfaces.

### Core UX
- [ ] **Chat input persistence** — `MessageInput` uses an uncontrolled textarea ref; draft text is lost on tab close. Fix: persist draft to `localStorage` keyed by session ID (e.g. `draft:<sessionId>`), restore on mount, clear on send. Add a debounced `onInput` handler to avoid writing on every keystroke.
- [ ] **Last project/session restoration** — revisit the restore-on-reload logic; current behaviour often resets to the topmost session/project instead of the one last visited
- [x] **Favicon** — `favicon.svg` (🧭 on blue background) added to `client/public/`; `index.html` updated with icon/apple-touch-icon/theme-color meta; `sw.js` updated to use `/favicon.svg` instead of missing `/icon-192.png`
- [ ] **Rich chat content rendering** — `MessageBubble` currently pipes raw `marked.parse()` output straight into `dangerouslySetInnerHTML` with no sanitization (XSS risk — fix with DOMPurify regardless of other work); beyond that, several rendering gaps to close:
  - **HTML sanitization** (security, do first): wrap `marked.parse()` output with `DOMPurify.sanitize()` before inserting into the DOM
  - **Mermaid diagrams**: detect fenced ` ```mermaid ` blocks and render them via `mermaid.js` instead of showing raw code; Claude generates these frequently
  - **Image rendering**: project-relative image paths in markdown (e.g. `![](./output.png)`) should resolve via the file binary endpoint so Claude-generated images display inline
  - **Sandboxed HTML preview**: when Claude produces a standalone HTML artifact (detected heuristically or via a special fence like ` ```html preview `), render it in a sandboxed `<iframe srcdoc>` with a toggle between source and preview views
  - **Math / LaTeX** (lower priority): KaTeX rendering for `$...$` and `$$...$$` blocks

### Push Notifications (hardening)
- [ ] **Revisit push notification reliability** — several known brittleness points to address:
  - `setVapidDetails` is re-called on every `notifyAll()` invocation; move to a one-time init
  - Transient send failures (non-410/404) are swallowed with `console.error`; add a retry or at-least structured error logging
  - `notified === 0` race: if the SSE tab closes just as Claude finishes, the watcher count may be wrong and the push is skipped — consider a small grace window or a persist-then-notify pattern
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

### Safe Core
- [ ] **Extending safe core** — discuss splitting into multiple focused safe-cores: current one stays as the Claude Code emergency interface; a second could expose read-only DB queries (session/project browser); further cores could cover other admin tasks. Consider shared port-allocation convention and a lightweight process registry.

### Permissions
- [ ] **Fine-grained tool permissions per session** — the current Plan/Edit/Full triad is coarse. Explore `--allowedTools` / `--disallowedTools` CLI flags (support patterns like `Bash(npm:*)`) to allow command-level whitelists and blacklists. Possible UX: an "Advanced" mode in the session header that exposes an editable allowed-tools list, stored as `allowed_tools TEXT` on the sessions row and passed via `--allowedTools` at spawn time.

### Testing
- [ ] **Migration unit tests** — cover the three startup scenarios in Vitest: (1) fresh DB → `seedStewardProject` creates the project with correct name/path; (2) existing DB with orphaned sessions → `migrateOrphanedSessions` reassigns them; (3) existing DB with steward project already present → both functions are true no-ops (no duplicates). Each test gets its own `DATABASE_PATH` temp file via the existing `setup.ts` pattern.
- [ ] **Fresh-install integration test** — container or isolated-directory smoke test that simulates a real first-run: clone (or copy) the repo, create a minimal `.env`, run `npm install && npm start`, then assert: steward project present in `GET /api/projects`, server returns 200 on `/api/meta`, safe-mode reachable on `:3003`. Candidate approaches: a `Dockerfile.test` (most hermetic) or a GitHub Actions job on a clean runner with no pre-existing DB.

### Packaging
- [ ] **Capacitor shell** — thin native wrapper (iOS + Android + desktop) using Capacitor's remote URL mode pointing at the server; `mobile/` package in monorepo with `capacitor.config.ts`; no bundled assets — always loads from server URL
