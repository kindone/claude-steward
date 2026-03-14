# Claude Steward

> **Work in progress** — core features are functional but the project is actively evolving.

A self-hosted, always-on Claude Code environment accessible from desktop and mobile.

Not a Claude.ai clone — a remotely deployed personal agent platform that can evolve itself. You install it on a server you control, access it from any browser, and let it manage files, run code, and even upgrade its own source.

---

## Prerequisites

### Required

**Node.js 22.5 or later** (23 recommended)
The server uses `node:sqlite`, a built-in module available from Node.js 22.5+. Earlier versions will fail to start.
```bash
node --version   # must be v22.5.0 or higher
```

**Claude Code CLI** — the AI engine that powers all chat sessions.

1. Install from [claude.ai/code](https://claude.ai/code) or via npm:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
2. Authenticate:
   ```bash
   claude login
   ```
3. Find your binary path (needed for `CLAUDE_PATH` in `.env`):
   ```bash
   which claude        # e.g. /usr/local/bin/claude
   # or on macOS/Linux if installed via the installer:
   ls ~/.local/bin/claude
   ```

### For production / always-on deployment

**PM2** — process manager that keeps both servers alive and handles restarts.
```bash
npm install -g pm2
```

### For E2E tests only

**Playwright browsers** — downloaded once after `npm install`:
```bash
npx playwright install chromium
```

---

## Key Properties

- **Remote-first** — runs on a VPS or home server; access from any device over the web
- **Project-centric** — each project maps to a real directory; Claude Code sessions work within it
- **Self-managing** — the app is one of its own projects; Claude can edit, build, and deploy it from chat
- **Safe-mode core** — a frozen, dependency-free emergency terminal on `:3003` that survives main app crashes
- **Proactive scheduler** *(planned)* — schedule conversation reminders; a meta-agent fires them via `node-cron` and push notifications
- **Mini-app platform** *(planned)* — projects can be living web apps that Claude builds and maintains alongside the chat

---

## Quick Start

> Ensure the [prerequisites](#prerequisites) above are met first.

```bash
cp .env.example .env                        # set API_KEY (any secret string) and CLAUDE_PATH
echo "VITE_API_KEY=<same key>" > client/.env.local

npm install
npm run dev                                 # server :3001 + client :5173
```

`API_KEY` is a secret you choose — it's the Bearer token the client sends to authenticate with the server. Set it to any strong random string and use the same value in both `.env` and `client/.env.local`.

### Production

```bash
npm run build                               # client → server/public/, tsc for server
npm start                                   # single port, static + API
```

### Testing

```bash
npm test                                    # unit + component tests (~4s, no servers needed)
npm run test:e2e                            # E2E smoke tests (auto-starts dev servers)
npm run test:all                            # everything
```

### Always-on deployment

For always-on deployment, use the included PM2 config:

```bash
pm2 start ecosystem.config.cjs
```

This starts two processes: `steward-main` (main app, upgradeable) and `steward-safe` (emergency terminal, frozen).

---

## Documentation

| Doc | Contents |
|---|---|
| [Architecture](docs/architecture.md) | Repo layout, port map, cross-program interfaces, shared config and database schema |
| [Server](docs/server.md) | Express routes, session lifecycle, SSE protocol, Claude subprocess gotchas, testing |
| [Client](docs/client.md) | Component tree, state management, SSE client, Vite config, testing |
| [Safe-Mode Core](docs/safe.md) | Emergency terminal internals, freeze policy |
| [Self-Management](docs/self-management.md) | In-app upgrade flow, app-level SSE events, PM2 config |
| [Roadmap](docs/roadmap.md) | Planned features: scheduler, MCP, Capacitor packaging, mini-app platform |

---

## Project Files

| File | Purpose |
|---|---|
| `MEMORY.md` | Machine-readable context for AI agents resuming this project |
| `TODO.md` | Canonical task list |
| `archived_tasks.md` | Completed items (kept separate to reduce token load) |
| `.env.example` | Environment variable template |
| `ecosystem.config.cjs` | PM2 process config |
