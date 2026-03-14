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
- [ ] **Session reordering** — move active session to top of list on each new message (`updated_at` already tracked)
- [ ] **Edit session title** — inline rename in sidebar (double-click or pencil icon); `PATCH /api/sessions/:id`
- [ ] **Copy message button** — copy-to-clipboard on assistant bubbles
- [ ] **Keyboard shortcuts** — `Cmd+N` new session, `Cmd+[` / `Cmd+]` prev/next session

### Scheduler
- [ ] **Scheduled conversation resume** — `schedules` table (`id`, `session_id`, `cron`, `prompt_context`, `enabled`); `node-cron` runner injects context-aware wake messages ("would you like to resume the conversation about X?")
- [ ] **Push notifications** — FCM / web push to registered devices; fires when scheduler produces output while browser is closed
- [ ] **Scheduler UI** — list/create/toggle schedules; associate with a session; set reminder text

### Workspace / Files
- [ ] **System prompt per session** — optional text injected before every message; stored in `sessions` table; UI to set it
- [ ] **MCP support** — pass `--mcp-config <path>` to spawn args; `mcp_configs` table per project; UI to manage JSON configs

### Integrations
- [ ] **Amazing Marvin** — scheduled session that pulls tasks from Marvin API, summarizes via Claude, pushes updates back

### Self-management
- [ ] **Steward-as-project** — add the steward repo itself as a project in the UI once the projects milestone is done

### Packaging
- [ ] **Capacitor shell** — thin native wrapper (iOS + Android + desktop) using Capacitor's remote URL mode pointing at the server; `mobile/` package in monorepo with `capacitor.config.ts`; no bundled assets — always loads from server URL
