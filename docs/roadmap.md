# Roadmap

Planned features in rough priority order. Completed items live in `archived_tasks.md`.

---

## Projects Milestone (next sprint)

- [ ] **`projects` table** — `id`, `name`, `path` (server directory), `created_at`; add `project_id` FK to `sessions`
- [ ] **Project switcher UI** — list projects in sidebar header; create project (name + server path); switch active project
- [ ] **Session scoping** — sessions list filtered by active project; new sessions inherit project `path` as `--cwd` for claude
- [ ] **File system navigation** — simple tree view browsing the project's `path`; file open/view to start

---

## Mini-App Platform

Projects can be "living artifacts" — embeddable web apps that Claude builds and maintains alongside the chat.

- [ ] **`steward-app.json` manifest spec** — `name`, `type`, `devCommand`, `port`, `buildCommand`; the pluggable contract that makes any project embeddable regardless of tech stack
- [ ] **Sidecar process manager** — spawn/stop/restart mini-app processes per project; `GET /api/projects/:id/app/status`, `POST /api/projects/:id/app/start|stop`
- [ ] **Split-panel UI** — resizable divider; iframe embed of running mini-app; collapse/expand to full-screen
- [ ] **Project templates** — starters for `docs` (MkDocs-style learning material), `notebook` (Observable-style live code cells + visualizations), `webapp` (Vite + React + Leaflet for travel-type apps)
- [ ] **Claude as app maker** — scaffold new mini-apps via chat, modify files, trigger live-reload via sidecar manager

---

## Core UX

- [ ] **Session reordering** — move active session to top of list on each new message (`updated_at` already tracked)
- [ ] **Edit session title** — inline rename in sidebar (double-click or pencil icon); `PATCH /api/sessions/:id`
- [ ] **Copy message button** — copy-to-clipboard on assistant bubbles
- [ ] **Keyboard shortcuts** — `Cmd+N` new session, `Cmd+[` / `Cmd+]` prev/next session

---

## Scheduler

- [ ] **Scheduled conversation resume** — `schedules` table (`id`, `session_id`, `cron`, `prompt_context`, `enabled`); `node-cron` runner injects context-aware wake messages ("would you like to resume the conversation about X?")
- [ ] **Push notifications** — FCM / web push to registered devices; fires when scheduler produces output while browser is closed
- [ ] **Scheduler UI** — list/create/toggle schedules; associate with a session; set reminder text

---

## Workspace / Files

- [ ] **System prompt per session** — optional text injected before every message; stored in `sessions` table; UI to set it
- [ ] **MCP support** — pass `--mcp-config <path>` to spawn args; `mcp_configs` table per project; UI to manage JSON configs

---

## Integrations

- [ ] **Amazing Marvin** — scheduled session that pulls tasks from Marvin API, summarizes via Claude, pushes updates back

---

## Self-Management

- [ ] **Steward-as-project** — add the steward repo itself as a project in the UI once the projects milestone is done

---

## Packaging

- [ ] **Mobile wrapper** — React Native / Flutter thin shell (Capacitor or Expo WebView) once feature set stabilizes
