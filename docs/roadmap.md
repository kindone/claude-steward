# Roadmap

High-level description of planned milestones. For the actionable task list see [`TODO.md`](../TODO.md); for completed work see [`archived_tasks.md`](../archived_tasks.md).

---

## Projects Milestone *(next sprint)*

The foundational building block for everything else. Right now sessions are free-floating; this milestone ties them to a **project** — a named directory on the server. Claude Code sessions run with that directory as their working root (`--cwd`), so the AI is always operating in a meaningful context rather than wherever the process happens to be.

A simple file system tree view will let you browse project files from the browser — starting with read-only view and growing from there.

---

## Mini-App Platform

Projects can be more than just chat sessions — they can be **living artifacts**: embedded web apps that Claude builds and maintains alongside the conversation. A `steward-app.json` manifest declares how to start the app (`devCommand`, `port`, etc.). The server spawns it as a sidecar process; the UI embeds it in a split-panel view alongside the chat.

Three standard app types are envisioned:
- **`docs`** — MkDocs-style rendered documentation; Claude writes markdown, build pipeline renders it
- **`notebook`** — Observable-style live code cells and visualizations for data exploration
- **`webapp`** — Fully custom; e.g. a "Rome Hotels" travel research app with maps, photos, and price comparisons

---

## Core UX

Quality-of-life improvements to the main chat interface: session reordering, inline title editing, copy-to-clipboard on messages, and keyboard shortcuts for session navigation.

---

## Scheduler

Conversations that continue themselves. You tell Claude "remind me tomorrow evening about this" — it stores the intent, fires it via `node-cron`, sends a push notification, and injects a context-aware wake message into the session. A meta-agent manages the schedule and wakes the appropriate session at the right time.

---

## Workspace / Files

Per-session system prompts and MCP (Model Context Protocol) config management — letting you wire up external tools and data sources to individual projects without touching the server.

---

## Integrations

- **Amazing Marvin** — a scheduled session that syncs tasks from the Marvin API, summarises via Claude, and pushes updates back.

---

## Self-Management

Once the projects milestone is done, add the steward repo itself as a project in the UI. Claude can then edit source files, run builds, and trigger live reloads — all from within the chat interface it lives in.

---

## Packaging

A **Capacitor** shell — a thin native wrapper for iOS, Android, and desktop that uses Capacitor's remote URL mode. The native app contains no bundled web assets; it simply opens the server's URL in a WebView. This means UI updates deploy instantly without app store resubmissions, staying true to the remote-first architecture.

Structure: a `mobile/` package in the monorepo with `capacitor.config.ts` pointing `server.url` at the production server, plus the generated `ios/` and `android/` native projects.
