# Claude Steward — TODO

Canonical task list. Completed items → `archived_tasks.md`. Bugs → `BUGS.md`. Milestone context → `docs/roadmap.md`.

---

## Notes

- **Verify fixes after reload** — bug fixes only take effect after `npm run build` + server reload (`POST /api/admin/reload`). Any fix applied during an active coding session won't be live until the next reload. Worth smoke-testing each fix after deploying.

---

## Planned

### Mini-App Platform
- [ ] **`steward-app.json` manifest spec** — `name`, `type`, `devCommand`, `port`, `buildCommand`; the pluggable contract that makes any project embeddable
- [ ] **Sidecar process manager** — spawn/stop/restart mini-app processes per project; `GET /api/projects/:id/app/status`, `POST /api/projects/:id/app/start|stop`
- [ ] **Split-panel UI** — resizable divider; iframe embed of running mini-app; collapse/expand to full-screen
- [ ] **Project templates** — starters for `docs` (MkDocs-style), `notebook` (live code cells + output), `webapp` (Vite + React + Leaflet for travel-type apps)
- [ ] **Claude as app maker** — scaffold new mini-apps via chat, modify files, trigger live-reload via sidecar manager

### Scheduler
- [ ] **Complex schedule support** — 5-field cron cannot express biweekly, "last day of month", "Nth weekday", or exclusions natively. Two approaches to explore: (a) **schedule groups** — a named group of N cron entries that fire together, letting biweekly be expressed as two alternating weekly schedules with a shared label and toggle; (b) **condition field** — a lightweight filter evaluated at fire time (e.g. `{"type": "biweekly", "ref": "<ISO date>"}`) that skips the run if the condition isn't met, keeping the cron wakeup cheap and the logic in the scheduler. Trade-off: groups are simpler and composable; conditions are more expressive but require a small DSL and per-type evaluators. Claude's prompt fragment already gracefully explains the limitation and enumerates workarounds — any implementation should align with that UX.

### Core UX
- [ ] **`after=<id>` message fetch endpoint** — `GET /api/sessions/:id/messages?after=<messageId>` returns only messages newer than the given ID; client uses it on visibility-change to append new messages without replacing the full view. Currently the visibility-change re-fetch loads the latest 50 and replaces state, which loses scroll position if the user had paged into older messages. Low priority — >50 new messages while backgrounded is practically impossible in a chat app.
- [ ] **Client-side JS console for AI** — a browser-side REPL that Claude can interact with via a tool or SSE channel. Lets Claude evaluate JS expressions in the live page context (DOM queries, state inspection, exception capture) without relying on the user to relay errors. Useful for debugging rendering issues (e.g. swallowed exceptions, layout problems) and verifying UI changes. Possible approach: a `POST /api/projects/:id/eval` endpoint that pushes JS to the client via SSE, executes it via `eval()` in a sandboxed scope, and returns the result/exception back to the server.
- [x] **Rich chat content rendering** — ` ```mermaid ` → SVG via mermaid.js (dark theme; SVG cache survives React re-renders/scroll); ` ```html ` → sandboxed `<iframe srcdoc>` with source/preview toggle; relative image paths rewritten to `/api/projects/:id/files/raw`; `$...$` / `$$...$$` → KaTeX; implemented in `client/src/lib/markdownRenderer.ts` + `HtmlPreview.tsx`

### Push Notifications (hardening)
- [ ] **Push notification improvements** — (send bugs tracked in `BUGS.md`); remaining feature gaps:
  - No per-session or per-user targeting (all subscribers get all notifications); prerequisite for the scheduler per-session opt-in
  - iOS requires "Add to Home Screen" with no in-app guidance; add a dismissible install prompt or at least a tooltip on the bell icon

### Workspace / Files
- [ ] **File upload / download** — download button per file in the file browser (binary endpoint already exists, just needs UI); upload via drag-and-drop or file picker into a selected directory (`POST /api/projects/:id/files/upload` multipart endpoint + tree UI entry point); v2: attach a file to a chat message so Claude can work with it directly
- [ ] **MCP support** — pass `--mcp-config <path>` to spawn args; `mcp_configs` table per project; UI to manage JSON configs

### Integrations
- [ ] **Amazing Marvin** — scheduled session that pulls tasks from Marvin API, summarizes via Claude, pushes updates back

### Dev Hot-Reload Resilience
- [ ] **Server restart → error bubble (scenario 2)** — when `sendMessage` SSE drops without a terminal event (e.g. tsx watch restarts the server mid-stream), `onError` fires and marks the assistant bubble as a permanent error, even though the worker keeps running and the message completes successfully. Fix: in `handleSend`'s `onError`, detect connection-drop errors (stream ended without `done`/`error`) and switch to `watchSession` mode instead of marking error — same recovery path Tab 2 already uses correctly.
- [ ] **Worker restart → SSE hangs for 90 seconds (scenario 3)** — when the worker process restarts (tsx watch), the in-flight Claude job is killed (irrecoverable). The worker client clears its subscription handlers without notifying them, leaving the client's `sendMessage` SSE open and idle until the 90-second inactivity timeout fires. Fix: either (a) reduce the inactivity timeout significantly (e.g. 10–15s), or (b) have `WorkerClient` emit a synthetic error event to active handlers on socket close so the SSE closes immediately with a clean error.
- [ ] **Tool calls on direct-spawn path** — worker + `result_reply` recovery now persist `tool_calls` to steward.db (`worker.db.jobs.tool_calls`, shared `extractToolDetail` in `server/src/claude/toolDetail.ts`). **Direct-spawn** fallback (`process.ts`) still does not write `tool_calls`; add if parity needed when worker is down.

### Claude Code Project Structure
- [x] **`CLAUDE.md` at repo root** — the most impactful gap: Claude Code auto-loads this on every session; consolidate key content from `MEMORY.md` + docs gotchas (env var stripping, safe/ freeze, CI=true, etc.) + build/test/lint commands + current focus areas so every session is immediately oriented without relying on the auto-memory system
- [x] **`.claude/commands/`** — custom slash commands: `/deploy` (build → reload) and `/test` (test strategy + commands)
- [x] **`.claude/settings.json`** — project-level tool permissions; allow build/test/status, deny commit/push/rm-rf
- [x] **`server/CLAUDE.md` + `client/CLAUDE.md`** — per-subdirectory context for server-specific (Express/worker/SQLite patterns) and client-specific (React/Tailwind/Vite patterns) rules
- [ ] **`.mcp.json`** — MCP server config; a custom MCP server querying steward.db or wrapping pm2/nginx commands would be natural for self-management
- [ ] **ADRs in `docs/adr/`** — structured Architecture Decision Records capturing *why* key decisions were made (node:sqlite over better-sqlite3, worker IPC over in-process, safe/ freeze policy); helps Claude judge whether constraints are load-bearing

### Dev / Production Workflow
- [ ] **Production deploy workflow** — develop + test on `dev.steward.jradoo.com` → `npm run build` → `POST /api/admin/reload` hot-reloads `steward.jradoo.com`; document and wire up the build step so deploying is a single command
- [ ] **Environment switcher UI** — floating toggle (authenticated users only) to navigate between `steward.jradoo.com` (prod) and `dev.steward.jradoo.com` (dev); consider long-press on header to avoid accidental switches; works in Capacitor WebView too

### Operational Reliability
- [ ] **Enhanced `npm run status`** — extend beyond port checks to cover: PM2 process names + states, required env vars present (`APP_DOMAIN`, `VAPID_PUBLIC_KEY`), nginx `proxy_pass` targets match expected ports, live nginx config matches repo copy (`config/nginx-*.conf`), `server/public/` freshness for prod, TLS cert expiry days
- [ ] **External health monitor** — GitHub Actions scheduled workflow (every 5 min) that `curl`s all three public URLs (`steward`, `dev.steward`, `safe.steward`) and sends a push notification on failure; catches EC2-level and nginx-level outages that an on-server check cannot

### Safe Core
- [ ] **Extending safe core** — discuss splitting into multiple focused safe-cores: current one stays as the Claude Code emergency interface; a second could expose read-only DB queries (session/project browser); further cores could cover other admin tasks. Consider shared port-allocation convention and a lightweight process registry.

### Permissions
- [ ] **Fine-grained tool permissions per session** — the current Plan/Edit/Full triad is coarse. Explore `--allowedTools` / `--disallowedTools` CLI flags (support patterns like `Bash(npm:*)`) to allow command-level whitelists and blacklists. Possible UX: an "Advanced" mode in the session header that exposes an editable allowed-tools list, stored as `allowed_tools TEXT` on the sessions row and passed via `--allowedTools` at spawn time.

### Testing
- [ ] **Migration unit tests** — cover the three startup scenarios in Vitest: (1) fresh DB → `seedStewardProject` creates the project with correct name/path; (2) existing DB with orphaned sessions → `migrateOrphanedSessions` reassigns them; (3) existing DB with steward project already present → both functions are true no-ops (no duplicates). Each test gets its own `DATABASE_PATH` temp file via the existing `setup.ts` pattern.
- [ ] **Fresh-install integration test** — container or isolated-directory smoke test that simulates a real first-run: clone (or copy) the repo, create a minimal `.env`, run `npm install && npm start`, then assert: steward project present in `GET /api/projects`, server returns 200 on `/api/meta`, safe-mode reachable on `:3003`. Candidate approaches: a `Dockerfile.test` (most hermetic) or a GitHub Actions job on a clean runner with no pre-existing DB.

### Packaging
- [ ] **Capacitor shell** — thin native wrapper (iOS + Android + desktop) using Capacitor's remote URL mode pointing at the server; `mobile/` package in monorepo with `capacitor.config.ts`; no bundled assets — always loads from server URL
