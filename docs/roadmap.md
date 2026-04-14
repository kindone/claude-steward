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
Keyboard shortcuts (`Cmd/Ctrl+N/[/]`), session reordering by recency, inline rename, message pagination, scroll-to-bottom button, draft persistence, token/cost display, context-limit banner with "Compact & Continue", session compaction, multi-client sync via `GET /api/sessions/:id/subscribe`, mobile-responsive layout (drawer sidebar, 44px touch targets, iOS dynamic toolbar). Message timestamps, date separators, smart Bash tool labels (shows `git`, `npm`, `pm2` etc.), image gallery with lightbox, error console drawer.

### Artifact System
Persistent side-panel ("Art" tab) storing named, versioned artifacts keyed to a project. Artifact types: `chart` (Vega-Lite, interactive zoom/pan via vega-embed), `report` (Markdown with sidenotes and link previews), `data` (JSON/CSV table), `code` (syntax-highlighted, runnable), `html` (sandboxed iframe with auto-resize), `pikchr` (compiled WASM SVG diagrams), `mdart` (MdArt vector diagrams). CodeMirror 6 editor with split source/preview pane. Refresh command + cron schedule per artifact. `@mention` autocomplete injects artifact content into prompts. System prompt manifest lists all project artifacts for every session.

MCP artifact tools (`steward-artifacts` server): `artifact_list`, `artifact_create`, `artifact_update` — Claude agents create and update artifacts mid-conversation without HTTP auth. Artifacts live in `artifacts/<uuid>-<slug>.<ext>` files alongside the DB.

Vega-Lite stock chart scripts: `stock-chart-vl`, `compare-chart-vl`, `overview-chart-vl` — publish interactive candlestick and comparison charts as `chart` artifacts via `artifact_create`/`artifact_update` MCP tools.

### MdArt Diagram System
Markdown-fenced diagram renderer (` ```mdart `) that compiles to inline SVG via a pure-JS layout engine. 10 families, 99 layout types: Process (18), List (15), Cycle (9), Matrix (7), Hierarchy (10), Pyramid (5), Relationship (14), Statistical (9), Planning (7), Technical (7). Semantic DSL: indented lists for hierarchy, `→` for directed edges, `∩` for Venn intersections, `[attr]` tags, `key: value` pairs. Renders in chat messages, `report` artifact embeds, and as standalone `mdart` artifacts. System prompt describes all 99 types with syntax examples.

### Pikchr Rendering
Custom Emscripten-compiled WASM bundle (`client/public/vendor/pikchr.js`, ~147KB) from pikchr.org fossil trunk. ` ```pikchr ` fences render inline SVG in chat with white background. Standalone `pikchr` artifact type with `PikchrView`. Save-to-artifact button on hover.

### Inline Code Execution (Kernels)
▶ Run button on code blocks in chat messages (Python, Node/JS/TS, Bash, C++). Output streams inline below the block; "↑ Send to Claude" feeds result back into the conversation. Kernels are project-scoped (`projectId:name:language`), survive session compaction, idle-timeout after 30 minutes. `KernelSelector` header widget shows active kernels with reset/kill actions. 💾 Save as Cell dialog persists code to `<projectPath>/notebooks/<notebook>/cells/` with git init.

### Reassembly — Live Document Layer
Explorations toward a live document graph where knowledge pieces connect and stay in sync.

Shipped components:
- **Sidenotes** — `[^n]` footnotes render in a right margin column in `report` artifacts; three responsive layout modes (compact/narrow/rich) via `ResizeObserver`; SVG connector lines with rounded corners and dotted strokes.
- **Link preview cards** — hover/tap any link in a report to see a preview card; `artifact:Name` links show artifact title + excerpt; external URLs proxied through server for metadata. Auto-dismiss with per-platform timer (mobile vs desktop). Portal-rendered, viewport-aware positioning.
- **Excerpt Anchor POC** — interactive HTML artifact demonstrating Yjs CRDT-backed excerpt anchors with high-resolution operation history. Two-peer (Author/Reader) offline-first model with manual sync, AnchorEffectType classification (6 types), narrative change log, conflict resolution UI, reader gutter position indicator.

Direction: documents as graphs — addressable named regions (excerpts), sync modes (auto/pull/push/snapshot), edge functions (extract/transform/render/LLM). See "Live Document Graph — Design Concept" artifact.

---

## Planned

### Mini-App Platform (partial)

Projects can be more than chat sessions — **living artifacts**: embedded web apps Claude builds and maintains alongside the conversation. The server spawns a sidecar process per mini-app; the UI embeds it in a split-panel iframe.

Shipped app types:
- **`docs`** — MkDocs proxy with injected Claude chat panel (floating toggle, persistent messages, model selector, compact/new with inline confirmation dialogs) + presenter/slideshow mode. See [`docs/apps-docs.md`](apps-docs.md).
- **`notebook`** — Multi-language live-code-cell notebook (Python, Node, Bash, C++); React+Vite client; SQLite cell store; SSE execution streaming; Claude chat panel beside the notebook. See `apps/notebook/`.

Still planned:
- **`webapp`** — Fully custom; e.g. a travel research app with maps and price comparisons

### Workspace / Files
File upload/download UI (binary endpoint already exists). MCP (Model Context Protocol) config management per project — wire up external tools without touching the server.

### Integrations
- **Amazing Marvin** — scheduled session that syncs tasks from the Marvin API, summarises via Claude, pushes updates back.

### Packaging
A **Capacitor** shell — thin native wrapper for iOS, Android, and desktop using Capacitor's remote URL mode. The native app contains no bundled assets; it opens the server URL in a WebView. UI updates deploy instantly without app store resubmissions.
