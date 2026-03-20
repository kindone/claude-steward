# Architecture Overview

This document covers the overall system structure, how the three programs relate, and the shared configuration and data model. For internal details see the program-specific docs.

| Doc | Scope |
|---|---|
| [Server](server.md) | Express routes, session lifecycle, SSE protocol, Claude subprocess |
| [Client](client.md) | React components, state, SSE client, Vite config |
| [File Browser](file-browser.md) | File listing, viewer, editor, optimistic locking, binary/raw endpoint |
| [Terminal Panel](terminal.md) | Exec endpoint, xterm.js rendering, SSE streaming, node-pty rationale |
| [Safe-Mode Core](safe.md) | Emergency terminal internals and freeze policy |
| [Self-Management](self-management.md) | In-app upgrade flow, PM2 process management, nginx dev/prod switching |
| [Worker protocol](worker-protocol.md) | Claude worker process, Unix socket IPC, `worker.db`, recovery flow |
| [Roadmap](roadmap.md) | Planned features |

---

## Repository Structure

```
claude-steward/               ← npm workspace root
├── package.json              ← workspace config, npm run up/up:dev/down/logs/status
├── ecosystem.config.cjs      ← PM2 process config (production)
├── ecosystem.dev.config.cjs  ← PM2 process config (development)
├── .env                      ← secrets (gitignored)
├── .env.example              ← committed template
├── scripts/
│   ├── up.js                 ← port conflict check → pm2 start (shared by up and up:dev)
│   └── status.js             ← npm run status — checks all three ports
├── config/
│   └── nginx-dev.steward.conf ← nginx template for dev.steward subdomain (copy to /etc/nginx/sites-available/)
├── docs/                     ← architecture, server, client, file-browser, terminal, safe, self-management, roadmap
│
├── server/                   ← Node.js 23 + TypeScript (ESM)  → :3001
├── client/                   ← Vite 6 + React 19              → :5173 (dev)
└── safe/                     ← FROZEN emergency terminal       → :3003
```

---

## Port Map

| Port | Program | Notes |
|---|---|---|
| `80` | nginx | Redirects → HTTPS |
| `443` | nginx | TLS termination; routes by domain (see below) |
| `3001` | Main server | API + static files in production |
| `3003` | Safe-mode core | Always-on, independent PM2 process |
| `5173` | Client dev server | Vite; proxies `/api` → `:3001`. Not present in production |

### Domain routing (nginx)

| Domain | nginx upstream | When |
|---|---|---|
| `steward.jradoo.com` | `127.0.0.1:5173` | Dev mode |
| `steward.jradoo.com` | `127.0.0.1:3001` | Production mode |
| `safe.steward.jradoo.com` | `127.0.0.1:3003` | Always |

Switching between dev and production requires one `proxy_pass` line change in `/etc/nginx/sites-available/steward`. See [Self-Management](self-management.md) for the exact steps.

---

## Program Interfaces

```
Browser
  │  HTTPS (TLS terminated by nginx)
  ▼
nginx
  ├─ steward.jradoo.com      → :5173 (dev) or :3001 (prod)
  └─ safe.steward.jradoo.com → :3003

  ┌─────────────────────────────────────────────────────────┐
  │  steward.jradoo.com                                     │
  │                                                         │
  │  GET  /api/meta                 app metadata (no auth)  │
  │  POST /api/auth/register/start  passkey registration    │
  │  POST /api/auth/register/finish                         │
  │  POST /api/auth/login/start     passkey login           │
  │  POST /api/auth/login/finish    → sets sid cookie       │
  │  POST /api/auth/logout          clears sid cookie       │
  │  GET  /api/auth/status          { authenticated, hasCredentials } │
  │                                                         │
  │  All requests below require: sid cookie (or API_KEY fallback)
  │                                                         │
  │  GET/POST/DELETE /api/projects            project CRUD      │
  │  GET/POST/PATCH/DELETE /api/sessions      session CRUD      │
  │  GET  /api/sessions/:id/messages          paginated history │
  │  GET  /api/sessions/:id/watch             SSE completion ping│
  │  POST /api/chat                           SSE chat stream   │
  │  GET  /api/events                         SSE app events    │
  │  GET  /api/projects/:id/files             directory listing │
  │  GET  /api/projects/:id/files/content     file content      │
  │  GET  /api/projects/:id/files/raw         binary file       │
  │  PATCH /api/projects/:id/files            atomic file write │
  │  POST /api/projects/:id/exec              SSE exec stream   │
  │  GET  /api/admin/version                                    │
  │  POST /api/admin/reload                   → PM2 restart    │
  │       │                                                 │
  │       ▼                                                 │
  │  Main server (:3001)                                    │
  │       │  spawns                                         │
  │       ▼                                                 │
  │  claude CLI subprocess                                  │
  │       stdout NDJSON → server → SSE → browser           │
  └─────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────┐
  │  safe.steward.jradoo.com                                │
  │                                                         │
  │  POST /chat   SSE stream (--dangerously-skip-permissions)│
  │  GET  /ping                                             │
  │       │  Same API_KEY bearer token                      │
  │       ▼                                                 │
  │  Safe-mode server (:3003)                               │
  │       │  spawns                                         │
  │       ▼                                                 │
  │  claude CLI  (--dangerously-skip-permissions)           │
  └─────────────────────────────────────────────────────────┘
```

---

## Authentication

### Main app (`steward.jradoo.com`)

Uses **Passkeys (WebAuthn)**. The full flow:

1. Browser loads the React app → `GET /api/auth/status` (public, no auth required)
2. If `authenticated: false` → show `AuthPage`
   - **First visit** (`hasCredentials: false`): "Register this device" → calls `/api/auth/register/start` + `/api/auth/register/finish`
   - **Returning device** (`hasCredentials: true`): "Sign in with Passkey" → calls `/api/auth/login/start` + `/api/auth/login/finish`
3. On success the server issues a `sid` cookie (`HttpOnly; Secure; SameSite=Strict; Max-Age=30d`)
4. All subsequent `/api/*` requests include `credentials: 'include'`; the server validates the cookie in `requireAuth`

The server also accepts a `Authorization: Bearer <API_KEY>` header as a fallback — kept for the transition period until all devices are registered, after which `VITE_API_KEY` will be removed from the build.

Auth-related routes (`/api/auth/*`) are mounted **before** the `requireAuth` middleware and are fully public.

Credential storage: `passkey_credentials` table (credential ID + COSE public key + sign counter). Session storage: `auth_sessions` table (random 32-byte token + expiry). Challenges are kept in-memory with a 5-minute TTL (single-user, so one slot per operation type).

### Safe-mode (`safe.steward.jradoo.com`)

Independent auth: still uses `API_KEY` bearer token checked inline in `safe/server.js`. Safe-mode intentionally has no DB access and no dependency on the main auth system.

---

## Configuration

All config lives in `.env` at the monorepo root.

| Variable | Default | Description |
|---|---|---|
| `API_KEY` | — | Bearer token; still accepted as auth fallback during passkey rollout. Remove once all devices have passkeys registered. |
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
CREATE TABLE passkey_credentials (
  id           TEXT PRIMARY KEY,   -- base64url credential ID
  public_key   BLOB NOT NULL,      -- COSE-encoded public key
  counter      INTEGER NOT NULL,   -- sign counter (replay protection)
  transports   TEXT,               -- JSON array: ['internal','usb',…]
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER
)

CREATE TABLE auth_sessions (
  id           TEXT PRIMARY KEY,   -- 32-byte random token (base64url), stored in sid cookie
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at   INTEGER NOT NULL,   -- created_at + 30 days
  last_seen_at INTEGER
)

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
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  is_error   INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  status     TEXT NOT NULL DEFAULT 'complete',  -- complete | streaming | interrupted
  tool_calls TEXT                              -- JSON array of tool pill metadata (worker path + recovery)
)
```

Migrations add columns idempotently on older DBs. **`tool_calls`** is populated when chat runs through the **worker** (including **`result_reply`** recovery after an HTTP restart). Direct-spawn fallback does not yet write `tool_calls`. Details: [Server](server.md), [Worker protocol](worker-protocol.md).

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
| Markdown | `marked` | Lightweight, synchronous parse (chat messages + file viewer) |
| Syntax highlight | `highlight.js` | Post-render; chat messages and file viewer |
| Terminal rendering | `@xterm/xterm` + `@xterm/addon-fit` | ANSI/VT100 in the browser; no native pty |
| Dev runner | `tsx watch` | Hot-reload TypeScript without a separate compile step |
| Reverse proxy | nginx | TLS termination, HTTP→HTTPS redirect, SSE-safe proxy config |
| Auth | `@simplewebauthn/server` + `@simplewebauthn/browser` | Passkeys (WebAuthn); device-bound; no password |
| TLS certs | Let's Encrypt (certbot) | Auto-renewing; both domains covered |
