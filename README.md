# Claude Steward

A self-hosted, always-on Claude Code environment accessible from desktop and mobile.

Not a Claude.ai clone — a remotely deployed personal agent platform that can evolve itself. You install it on a server you control, access it from any browser, and let it manage files, run code, and even upgrade its own source.

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

```bash
cp .env.example .env                        # fill in API_KEY and CLAUDE_PATH
echo "VITE_API_KEY=<same key>" > client/.env.local

npm install
npm run dev                                 # server :3001 + client :5173
```

### Production

```bash
npm run build                               # client → server/public/, tsc for server
npm start                                   # single port, static + API
```

For always-on deployment, use the included PM2 config:

```bash
pm2 start ecosystem.config.cjs
```

This starts two processes: `steward-main` (main app, upgradeable) and `steward-safe` (emergency terminal, frozen).

---

## Documentation

| Doc | Contents |
|---|---|
| [Architecture](docs/architecture.md) | Repo structure, tech stack, request flows, session lifecycle, database schema, SSE protocol, config reference, Claude CLI gotchas, dev/build guide |
| [Self-Management & Safe-Mode](docs/self-management.md) | In-app upgrade flow, `/api/events` SSE stream, safe-mode core properties and freeze policy |
| [Roadmap](docs/roadmap.md) | Planned features: projects milestone, mini-app platform, scheduler, MCP, packaging |

---

## Project Files

| File | Purpose |
|---|---|
| `MEMORY.md` | Machine-readable context for AI agents resuming this project |
| `TODO.md` | Canonical task list |
| `archived_tasks.md` | Completed items (kept separate to reduce token load) |
| `.env.example` | Environment variable template |
| `ecosystem.config.cjs` | PM2 process config |
