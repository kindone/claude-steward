# Docs Mini-App

The `apps/docs/` package is the first concrete mini-app template. It wraps a MkDocs site with an Express proxy that injects a floating multi-CLI docs chat panel (Claude or OpenCode) plus a presenter/slideshow mode into every page.

---

## Architecture

```
Browser
  ↕ HTTPS (nginx)
apps/docs server  (:4001–:4010, assigned by sidecar slot)
  ├── proxy.ts       — pipes all non-API requests to internal MkDocs
  ├── mkdocs.ts      — spawns/stops `mkdocs serve` subprocess on :18765
  └── routes/
       ├── chat.ts   — POST /api/chat (SSE streaming via CLI adapters)
       └── file.ts   — GET/PATCH /file (read/edit a doc file from the panel)
```

MkDocs runs on a fixed internal port (**18765**) regardless of the public slot port. `proxy.ts` intercepts every HTML response and injects `<link rel="stylesheet" href="/chat-panel.css">` and `<script src="/chat-panel.js">` just before `</head>`. The injected files are served statically from `apps/docs/public/` — **no build step required**; edits take effect immediately on the next page load.

---

## Chat Panel (`public/chat-panel.js` + `public/chat-panel.css`)

A self-contained vanilla JS IIFE. No external dependencies, no bundler.

### Features

| Feature | Detail |
|---|---|
| **Floating toggle button** | Fixed bottom-right (✦); purple gradient, animated hover |
| **Chat panel** | Slides up from bottom-right (spring animation); 430 × 580 px; dark theme |
| **Open-state persistence** | `localStorage` key `claude-docs-open`; panel re-opens on page navigation without losing state |
| **Message persistence** | Up to 40 messages stored in `localStorage` key `claude-docs-chat`; survive full page reloads and navigation |
| **Stuck-stream recovery** | On load, any message with `isStreaming: true` is auto-healed to `false` |
| **CLI + model selectors** | Dual pill selects in the header: CLI picker (Claude ↔ OpenCode, disabled when a binary is missing) stored in `claude-docs-cli`, plus a per-CLI model list whose preferences are saved in a JSON map under `claude-docs-model`; every POST includes `{ cli, model }` so the server can route to the matching adapter |
| **CLI session lock** | CLI picker is disabled once the conversation has any messages and shows a tooltip explaining that CLI changes require **New session**. Model can still be changed between turns |
| **"New session" button** | Clears local chat history + deletes server-side chat sessions for every CLI; requires inline confirmation (see below) |
| **"Compact" button** | Trims displayed history to the last 6 messages (3 exchanges) in localStorage; **does not** clear the server session — the assistant retains full memory context |
| **Inline confirmation** | First click → button turns amber and shows "Sure?" for 3 s; second click → action executes; auto-reverts if ignored |
| **Markdown rendering** | Inline (`renderInline`) + block (`renderMarkdown`): headings, bold/italic/strikethrough, inline code, fenced code blocks with language badge, ordered/unordered lists, horizontal rules, links |
| **Tool call badges** | Compact pills below assistant messages showing Read/Edit/Write/Bash operations |
| **Streaming cursor** | Blinking caret appended during live assistant output |
| **Stop streaming** | Send button becomes ■; aborts the SSE fetch; `pagehide` event cleanly marks message non-streaming on navigate/close |
| **Page context** | `page_url: window.location.pathname` sent with every message so the assistant knows which doc page is being viewed |

### CSS specificity note

The reset rule `#claude-docs-chat * { margin: 0; box-sizing: border-box; }` uses ID specificity (1,0,0). **Never add `padding: 0` to that rule** — it would silently beat all `.cp-msg-user .cp-bubble` padding rules (0,2,0) and flatten all bubble padding across the panel.

---

## Presenter Mode (`public/chat-panel.js`)

A fullscreen slideshow built from the current MkDocs page's content.

- **Trigger**: the ▶ button, visible only when there is slideable content (≥2 `<h2>` elements or any `<hr>` from `---` in Markdown)
- **Slide splitting**: prefers `<hr>` boundaries; falls back to `<h2>` boundaries
- **Overlay**: `rgba(6,7,14,0.97)` fullscreen div; slide content in a centered card (`max-width: 820px`); inherits MkDocs Material typography via `.md-typeset` class
- **Navigation**: ← / → buttons; keyboard arrow keys; Escape to exit; counter `N / Total`
- **Animation**: `translateY(12px) → 0` fade-in per slide

---

## CLI integration (`src/cli/index.ts`, `src/cli/spawn.ts`, `src/routes/chat.ts`)

- `src/cli/index.ts` defines a `CliAdapter` contract (binary path, args/env builder, parser, capabilities, model list, error classifier). Two adapters ship out-of-the-box: `claude` and `opencode`. Each adapter carries a friendly label plus the dropdown models surfaced to the UI.
- `src/cli/spawn.ts` runs any adapter and translates its canonical events back into the legacy SSE format (`chunk` / `done` / `error`, tool use/result blocks, etc.) so the chat panel keeps streaming without changes.
- `routes/chat.ts` now accepts `{ message, page_url?, cli?, model? }`, tracks session IDs per CLI (`claude_session_id`, `cli_session_opencode`, …), exposes `/api/chat/meta` so the browser knows which CLIs/models are available, and surfaces the running job's CLI via `/api/chat/status` for reconnects. If the selected model changes for a CLI, the server drops that CLI's resume ID and starts a fresh backend session; OpenCode can otherwise hang when `-s <session>` is combined with a different `--model`.

---

## File structure

```
apps/docs/
├── src/
│   ├── server.ts          — Express app setup + static serving of public/
│   ├── proxy.ts           — MkDocs proxy + HTML injection
│   ├── mkdocs.ts          — mkdocs subprocess lifecycle
│   ├── cli/
│   │   ├── index.ts       — Adapter registry (Claude + OpenCode)
│   │   └── spawn.ts       — Adapter-agnostic launcher → SSE bridge
│   ├── claude/
│   │   └── system-prompt.ts
│   └── routes/
│       ├── chat.ts        — POST /api/chat (SSE), DELETE /api/chat/session
│       └── file.ts        — GET/PATCH /file (panel file read/edit)
├── public/
│   ├── chat-panel.js      — Self-contained panel IIFE (no build step)
│   └── chat-panel.css     — Panel styles (no build step)
├── template/              — MkDocs scaffold for new docs sites (see below)
├── package.json
└── tsconfig.json
```

---

## Running / integration

The app is registered as a mini-app in the sidecar. Its `command_template` in the DB is the Node.js start command (`node dist/server.js --port {port} --docs-dir <path>`), and the sidecar starts it when a slot is claimed. MkDocs must be installed (`pip install mkdocs-material`) in the project's working directory.

For the internal MkDocs proxy to work, port 18765 must be free and `mkdocs serve` must be reachable at `http://localhost:18765`.

---

## Creating a new docs site

The `apps/docs/` engine is reusable: one engine binary serves N independent MkDocs sites, each passed in via `--docs-dir`. To spin up a new site, use the scaffold at `apps/docs/template/`:

```bash
bash apps/docs/template/create-app.sh <app-name> [destination-dir]
# Example:
bash apps/docs/template/create-app.sh my-api-docs ~/my-api-docs
```

The script:

1. Copies `apps/docs/template/` to the destination (default: `~/<app-name>`)
2. Removes `create-app.sh` from the copy (so it doesn't propagate)
3. Patches `site_name` in `mkdocs.yml` to the given app name
4. Prints the `curl` commands to register the new content directory as a mini-app via `POST /api/projects/:id/apps` — the `commandTemplate` it prints points at this repo's built `apps/docs/dist/server.js` with `--docs-dir` set to the new content path

The generated content directory is independent of this repo — it can live anywhere on disk, have its own git history, add its own MkDocs plugins and custom hooks (e.g. `~/learn-pikchr/` adds `pikchr_hook.py` and a kroki plugin). The only coupling back to `apps/docs/` is the `commandTemplate` path.

### Template shape

```
apps/docs/template/
├── mkdocs.yml              — Material theme, dark/light toggle, nav tabs,
│                             code-copy, tabbed content
├── docs/
│   ├── index.md
│   ├── guide/{index,getting-started,configuration}.md
│   └── reference/index.md
├── create-app.sh
└── .gitignore              — site/, .docs-chat.db
```

The `.docs-chat.db` is the chat panel's runtime storage (SQLite), created by `apps/docs`'s server on first message. `site/` is `mkdocs build` output. Both are always project-local and never belong in git.
