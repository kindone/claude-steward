# Roadmap

High-level description of milestones — shipped and planned. For the actionable task list see [`TODO.md`](../TODO.md); for completed work see [`archived_tasks.md`](../archived_tasks.md).

---

## Shipped

### Projects
Sessions are scoped to a **project** — a named directory on the server. Claude Code sessions run with `--cwd` set to the project root. A file browser lets you navigate, view, and edit project files from the browser (syntax highlighting, image preview, Markdown rendering, atomic writes with optimistic locking). A terminal panel runs shell commands in the project directory. The steward repo itself is auto-seeded as a project so Claude can edit and rebuild itself.

### Scheduler
Conversations that continue themselves. Tell Claude "remind me tomorrow at 8am about X" — it emits a `<schedule>` JSON block that the server intercepts and stores. `node-cron` fires due schedules, injects a context-aware wake message into the session (with timezone, recent conversation, and task description), and sends a push notification if no browser tab is open. Per-session schedule management UI (bell icon in chat header): create, toggle, delete, next-fire display. One-shot schedules auto-delete after firing.

### Push Notifications
Web Push API with VAPID authentication. Per-session opt-in (🔔/🔕 toggle in the chat header). Notifications fire only when no browser tab is watching the session. Tapping a notification on mobile navigates directly to the correct session (including cross-project navigation via `?session=<id>&project=<id>` URL params). Stale subscriptions auto-deleted on 410/404.

### Auth — Passkeys + New Device Bootstrap
WebAuthn passkeys replace the API key for browser login. A new-device bootstrap flow lets you register a passkey on a device outside your iCloud/Google sync group by entering the server `API_KEY` — the biometric challenge still runs, so the key alone isn't enough.

### Core UX (shipped items)
Keyboard shortcuts (`Cmd/Ctrl+N/[/]`), session reordering by recency, inline rename, message pagination, scroll-to-bottom button, draft persistence, token/cost display, context-limit banner with "Compact & Continue", session compaction, multi-client sync via `GET /api/sessions/:id/subscribe`, mobile-responsive layout (drawer sidebar, 44px touch targets, iOS dynamic toolbar).

---

## Planned

### Mini-App Platform

Projects can be more than chat sessions — **living artifacts**: embedded web apps Claude builds and maintains alongside the conversation. A `steward-app.json` manifest declares how to start the app (`devCommand`, `port`, etc.). The server spawns it as a sidecar process; the UI embeds it in a split-panel view.

Three standard app types envisioned:
- **`docs`** — MkDocs-style rendered documentation
- **`notebook`** — Observable-style live code cells and visualisations
- **`webapp`** — Fully custom; e.g. a travel research app with maps and price comparisons

### Workspace / Files
File upload/download UI (binary endpoint already exists). MCP (Model Context Protocol) config management per project — wire up external tools without touching the server.

### Integrations
- **Amazing Marvin** — scheduled session that syncs tasks from the Marvin API, summarises via Claude, pushes updates back.

### Packaging
A **Capacitor** shell — thin native wrapper for iOS, Android, and desktop using Capacitor's remote URL mode. The native app contains no bundled assets; it opens the server URL in a WebView. UI updates deploy instantly without app store resubmissions.
