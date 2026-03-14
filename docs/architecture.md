# Architecture Overview

This document covers the overall system structure, how the three programs relate, and the shared configuration and data model. For internal details see the program-specific docs.

| Doc | Scope |
|---|---|
| [Server](server.md) | Express routes, session lifecycle, SSE protocol, Claude subprocess |
| [Client](client.md) | React components, state, SSE client, Vite config |
| [Safe-Mode Core](safe.md) | Emergency terminal internals and freeze policy |
| [Self-Management](self-management.md) | In-app upgrade flow, app-level events |
| [Roadmap](roadmap.md) | Planned features |

---

## Repository Structure

```
claude-steward/               ← npm workspace root
├── package.json              ← workspace config, concurrently dev script
├── ecosystem.config.cjs      ← PM2 process config (production)
├── .env                      ← secrets (gitignored)
├── .env.example              ← committed template
├── scripts/
│   └── status.js             ← npm run status — checks all three ports
│
├── server/                   ← Node.js 23 + TypeScript (ESM)  → :3001
├── client/                   ← Vite 6 + React 19              → :5173 (dev)
└── safe/                     ← FROZEN emergency terminal       → :3003
```

---

## Port Map

| Port | Program | Notes |
|---|---|---|
| `3001` | Main server | API + static files in production |
| `3003` | Safe-mode core | Always-on, independent PM2 process |
| `5173` | Client dev server | Vite; proxies `/api` → `:3001`. Not present in production |

---

## Program Interfaces

```
Browser (client)
  │
  ├─ GET  /api/meta                       app metadata (no auth); { appRoot }
  │
  │  All requests below carry:  Authorization: Bearer <API_KEY>
  │
  ├─ GET/POST/DELETE /api/projects        project CRUD (DELETE blocked for APP_ROOT)
  ├─ GET/POST/PATCH/DELETE /api/sessions  session CRUD (filterable by projectId)
  ├─ GET  /api/sessions/:id/messages      history
  ├─ POST /api/chat                       SSE stream (chat responses)
  ├─ GET  /api/events                     SSE stream (app-level: reload, notifications)
  ├─ GET  /api/admin/version
  └─ POST /api/admin/reload               triggers live reload via PM2
       │
       ▼
  Main server (:3001)
       │  spawns
       ▼
  claude CLI subprocess
       │  stdout NDJSON → server → SSE → browser

Browser (safe-mode tab)
  │  Same API_KEY bearer token
  └─ POST /chat  (SSE stream)
  └─ GET  /ping
       │
       ▼
  Safe-mode server (:3003)
       │  spawns
       ▼
  claude CLI  (--dangerously-skip-permissions)
```

---

## Authentication

A single shared secret (`API_KEY`) is used as a Bearer token for both servers. Both client apps send `Authorization: Bearer <API_KEY>` on every request.

The main server checks this in `server/src/auth/middleware.ts` applied to all `/api/*` routes. The safe-mode server checks it inline in `safe/server.js`.

The client reads the key from `VITE_API_KEY` (build-time) via `client/.env.local`.

---

## Configuration

All config lives in `.env` at the monorepo root.

| Variable | Default | Description |
|---|---|---|
| `API_KEY` | — | Bearer token; required. Also set in `client/.env.local` as `VITE_API_KEY` |
| `PORT` | `3001` | Main server port |
| `SAFE_PORT` | `3003` | Safe-mode server port |
| `DATABASE_PATH` | `server/steward.db` | Optional SQLite path override |
| `NODE_ENV` | `development` | `production` enables static file serving, disables CORS |
| `CLAUDE_PATH` | `~/.local/bin/claude` | Absolute path to the `claude` CLI binary |

`dotenv` is loaded in `server/src/index.ts` with an explicit path (`../../.env`) before any `process.env` access.

---

## Shared Data Model

`server/steward.db` (SQLite, WAL mode) is the single source of truth. The safe-mode server is stateless and has no DB access.

```sql
CREATE TABLE projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,           -- absolute path on the server filesystem
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)

CREATE TABLE sessions (
  id                TEXT PRIMARY KEY, -- server UUID, exposed to client
  title             TEXT NOT NULL DEFAULT 'New Chat',
  claude_session_id TEXT,             -- CLI handle; set after first message; used for --resume
  project_id        TEXT NOT NULL REFERENCES projects(id),  -- required since v2; orphans migrated on startup
  system_prompt     TEXT,             -- optional; passed as --system-prompt on every spawn
  permission_mode   TEXT NOT NULL DEFAULT 'acceptEdits',    -- plan | acceptEdits | bypassPermissions
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
)

CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role       TEXT NOT NULL,           -- 'user' | 'assistant'
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)
```

The two-ID session design separates concerns: `id` is a stable client-facing identifier; `claude_session_id` is an opaque CLI handle that only exists after the first message and is cleared automatically if a `--resume` attempt fails.

---

## Tech Stack Summary

| Layer | Choice | Why |
|---|---|---|
| Server runtime | Node.js 23 (ESM) | Built-in `node:sqlite`; no native addon compile issues |
| Server framework | Express 5 | Minimal, well-typed |
| Database | `node:sqlite` (built-in) | `better-sqlite3` fails on Node 23 (V8 ABI mismatch) |
| AI engine | `claude` CLI subprocess | Full Claude Code capabilities without SDK limitations |
| Client bundler | Vite 6 | Fast HMR, straightforward proxy config |
| UI framework | React 19 | Future path to React Native/Capacitor packaging |
| Markdown | `marked` | Lightweight, synchronous parse |
| Syntax highlight | `highlight.js` | Post-render, targets `pre code` blocks |
| Dev runner | `tsx watch` | Hot-reload TypeScript without a separate compile step |
