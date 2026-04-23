# Architecture Overview

This document covers the overall system structure, how the three programs relate, and the shared configuration and data model. For internal details see the program-specific docs.

| Doc | Scope |
|---|---|
| [Server](server.md) | Express routes, session lifecycle, SSE protocol, Claude subprocess |
| [Client](client.md) | React components, state, SSE client, Vite config |
| [Scheduler](scheduler.md) | Scheduled messages, cron runner, push-on-fire, timezone, SW navigation |
| [File Browser](file-browser.md) | File listing, viewer, editor, optimistic locking, binary/raw endpoint |
| [Terminal Panel](terminal.md) | Exec endpoint, xterm.js rendering, SSE streaming, node-pty rationale |
| [Safe-Mode Core](safe.md) | Emergency terminal internals and freeze policy |
| [Self-Management](self-management.md) | In-app upgrade flow, PM2 process management, nginx dev/prod switching |
| [Worker protocol](worker-protocol.md) | Claude worker process, Unix socket IPC, `worker.db`, recovery flow |
| [Apps Sidecar](apps-sidecar.md) | Mini-app process manager, slot model, Unix socket protocol |
| [Docker](docker.md) | Containerized test environment, auth isolation, OAuth token strategy |
| [Roadmap](roadmap.md) | Shipped milestones and planned features |

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
| `3001` | Main server (prod) | API + static files in production |
| `3002` | Main server (dev) | `tsx watch`; separate DB (`steward-dev.db`) |
| `3003` | Safe-mode core | Always-on, independent PM2 process |
| `5173` | Client dev server | Vite HMR; proxies `/api` → `:3002`. Not present in production |
| `4001–4010` | Mini-apps | Reserved for `steward-apps` sidecar; slot N binds port `400N` |
| `/tmp/claude-worker.sock` | Claude worker | Unix socket; always-on; survives HTTP restarts |
| `/tmp/claude-apps.sock` | Apps sidecar | Unix socket; manages mini-app child processes |

### Domain routing (nginx)

| Domain | nginx upstream | When |
|---|---|---|
| `steward.yourdomain.com` | `127.0.0.1:3001` | Production |
| `dev.steward.yourdomain.com` | `127.0.0.1:5173` | Dev (Vite HMR) |
| `safe.steward.yourdomain.com` | `127.0.0.1:3003` | Always |
| `app1–app10.steward.yourdomain.com` | `127.0.0.1:4001–4010` | Mini-apps (wildcard TLS cert) |

Switching between dev and production requires one `proxy_pass` line change in `/etc/nginx/sites-available/steward`. See [Self-Management](self-management.md) for the exact steps.

TLS: `steward.yourdomain.com` and `dev/safe` subdomains use individual certs. `app1–app10` use a wildcard cert (`*.steward.yourdomain.com`) provisioned via Let's Encrypt DNS-01 challenge with the Route 53 plugin. Config: `/etc/nginx/sites-available/steward-apps`.

---

## Program Interfaces

```
Browser
  │  HTTPS (TLS terminated by nginx)
  ▼
nginx
  ├─ steward.yourdomain.com          → :5173 (dev) or :3001 (prod)
  ├─ safe.steward.yourdomain.com    → :3003
  └─ app{1-10}.steward.yourdomain.com → :4001–:4010 (mini-apps)

  ┌─────────────────────────────────────────────────────────┐
  │  steward.yourdomain.com                                     │
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
  │  GET  /api/sessions/:id/subscribe         SSE multi-client sync│
  │  POST /api/sessions/:id/compact           summarise + fork  │
  │  GET/POST/PATCH/DELETE /api/schedules     schedule CRUD     │
  │  POST /api/schedules/:id/run              manual fire       │
  │  POST /api/chat                           SSE chat stream   │
  │  DELETE /api/chat/:sessionId              stop job          │
  │  GET  /api/events                         SSE app events    │
  │  GET  /api/projects/:id/files             directory listing │
  │  GET  /api/projects/:id/files/content     file content      │
  │  GET  /api/projects/:id/files/raw         binary file       │
  │  PATCH /api/projects/:id/files            atomic file write │
  │  POST /api/projects/:id/files/upload     multipart upload  │
  │  POST /api/projects/:id/exec              SSE exec stream   │
  │  GET  /api/push/vapid-public-key                            │
  │  POST/DELETE /api/push/subscribe                            │
  │  GET  /api/push/last-target          iOS poll fallback      │
  │  POST /api/events/visibility         fg/bg tracking         │
  │  GET/POST /api/projects/:id/apps          app config CRUD   │
  │  PATCH/DELETE /api/apps/:configId         update/delete     │
  │  POST /api/apps/:configId/start           claim slot+spawn  │
  │  POST /api/apps/:configId/stop            kill+release slot │
  │  GET  /api/apps/slots                     all 10 slot states│
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
  │  safe.steward.yourdomain.com                                │
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

### Main app (`steward.yourdomain.com`)

Uses **Passkeys (WebAuthn)**. The full flow:

1. Browser loads the React app → `GET /api/auth/status` (public, no auth required)
2. If `authenticated: false` → show `AuthPage`
   - **First visit** (`hasCredentials: false`): "Register this device" → calls `/api/auth/register/start` + `/api/auth/register/finish`
   - **Returning device** (`hasCredentials: true`): "Sign in with Passkey" → calls `/api/auth/login/start` + `/api/auth/login/finish`
   - **New device, no sync** (`hasCredentials: true`, no passkey available): "Register with API key" → enter `API_KEY` from `.env`; server accepts it via `X-Bootstrap-Key` header on `register/start`; full WebAuthn biometric ceremony still runs
3. On success the server issues a `sid` cookie (`HttpOnly; Secure; SameSite=Strict; Max-Age=30d`)
4. All subsequent `/api/*` requests include `credentials: 'include'`; the server validates the cookie in `requireAuth`

Auth-related routes (`/api/auth/*`) are mounted **before** the `requireAuth` middleware and are fully public.

Credential storage: `passkey_credentials` table (credential ID + COSE public key + sign counter). Session storage: `auth_sessions` table (random 32-byte token + expiry). Challenges are kept in-memory with a 5-minute TTL (single-user, so one slot per operation type).

### Safe-mode (`safe.steward.yourdomain.com`)

Independent auth: still uses `API_KEY` bearer token checked inline in `safe/server.js`. Safe-mode intentionally has no DB access and no dependency on the main auth system.

---

## Configuration

All config lives in `.env` at the monorepo root.

| Variable | Default | Description |
|---|---|---|
| `API_KEY` | — | Bootstrap key used only during device registration (`X-Bootstrap-Key` header on `/api/auth/register/start`). Not used for general API auth. |
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
  project_id        TEXT NOT NULL REFERENCES projects(id),  -- required; orphans migrated on startup
  system_prompt     TEXT,             -- optional; passed as --system-prompt on every spawn
  permission_mode   TEXT NOT NULL DEFAULT 'acceptEdits',    -- plan | acceptEdits | bypassPermissions
  timezone          TEXT,             -- IANA tz string e.g. 'Europe/Paris'; set by client on mount
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
  tool_calls TEXT,                             -- JSON array of tool pill metadata (worker path + recovery)
  source     TEXT                              -- null = user-initiated; 'scheduler' = scheduled trigger
)

CREATE TABLE push_subscriptions (
  id         TEXT PRIMARY KEY,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id),  -- null = global; non-null = session-scoped opt-in
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)

CREATE TABLE app_configs (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'mkdocs',
  command_template TEXT NOT NULL,   -- e.g. "mkdocs serve -a 0.0.0.0:{port}"; {port} substituted at start
  work_dir         TEXT NOT NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
)

CREATE TABLE app_slots (
  slot       INTEGER PRIMARY KEY,   -- 1–10; pre-seeded; slot N → port 400N
  config_id  TEXT REFERENCES app_configs(id) ON DELETE SET NULL,
  status     TEXT NOT NULL DEFAULT 'stopped',  -- stopped | starting | running | error
  pid        INTEGER,
  started_at INTEGER,
  error      TEXT
)

CREATE TABLE schedules (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  cron        TEXT NOT NULL,         -- 5-field UTC cron expression
  prompt      TEXT NOT NULL,         -- injected as task context at fire time
  label       TEXT,                  -- human-readable name shown in UI
  enabled     INTEGER NOT NULL DEFAULT 1,
  once        INTEGER NOT NULL DEFAULT 0,  -- 1 = auto-delete after first fire
  last_run_at INTEGER,
  next_run_at INTEGER,               -- pre-computed next UTC unix timestamp
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
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
