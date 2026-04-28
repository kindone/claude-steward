# Steward

> **Work in progress** — core features are functional but the project is actively evolving.

A self-hosted, always-on Claude Code environment accessible from desktop and mobile.

Not a Claude.ai clone — a remotely deployed personal agent platform that can evolve itself. You install it on a server you control, access it from any browser, and let it manage files, run code, and even upgrade its own source.

---

## Prerequisites

### Always required

**Node.js 22.5 or later** (23 recommended)
The server uses `node:sqlite`, a built-in module available from Node.js 22.5+.
```bash
node --version   # must be v22.5.0 or higher
```

**Claude Code CLI** — the AI engine that powers all chat sessions.
```bash
npm install -g @anthropic-ai/claude-code
claude login
which claude   # note this path for CLAUDE_PATH in .env
```

**PM2** — process manager used for both dev and production.
```bash
npm install -g pm2
```

### Required for full deployment (HTTPS + Passkeys)

Passkeys (WebAuthn) are the authentication mechanism. WebAuthn requires HTTPS and a real domain, so these are needed for any deployment that isn't purely local:

- **A domain name** pointed at your server (A record → server IP)
- **nginx** — reverse proxy that terminates TLS
  ```bash
  sudo apt install nginx
  ```
- **Certbot** — provisions and auto-renews Let's Encrypt certificates
  ```bash
  sudo apt install certbot python3-certbot-nginx
  sudo certbot --nginx -d yourdomain.com
  ```

After obtaining a cert, update `/etc/nginx/sites-available/your-site` so `proxy_pass` points to `http://127.0.0.1:3001` (production) or `http://127.0.0.1:5173` (dev). See [Self-Management](docs/self-management.md) for the exact nginx config.

### Optional

**Playwright browsers** — only needed for E2E tests:
```bash
npx playwright install chromium
```

---

## Key Properties

- **Remote-first** — runs on a VPS or home server; access from any device over the web
- **Project-centric** — each project maps to a real directory; Claude Code sessions work within it
- **Self-managing** — the app is one of its own projects; Claude can edit, build, and deploy it from chat
- **Passkey auth** — device-bound WebAuthn; no password; session cookie issued on successful assertion
- **Safe-mode core** — a frozen, dependency-free emergency terminal on `:3003` that survives main app crashes
- **Proactive scheduler** *(planned)* — schedule conversation reminders via `node-cron` and push notifications
- **Mini-app platform** *(planned)* — projects can be living web apps that Claude builds and maintains alongside the chat

---

## Quick Start

### Local development

```bash
cp .env.example .env        # fill in CLAUDE_PATH; API_KEY is optional for local use
npm install
npm run dev                 # server :3001 + Vite client :5173 (concurrently)
```

Open `http://localhost:5173`. On first visit the app will prompt you to register a passkey.

> **Note:** Passkeys on `localhost` use a separate credential store from your production domain. Any browser that supports WebAuthn will work locally.

### Always-on dev mode (survives SSH disconnects)

```bash
npm run up:dev              # PM2 starts steward-server (:3002) + steward-client (:5173) + steward-safe (:3003)
npm run down                # stop all steward processes
npm run logs                # tail all process logs
npm run status              # check all ports
```

### Production

```bash
npm run build               # client → server/public/, tsc for server
npm run up                  # PM2 starts steward-main (:3001) + steward-safe (:3003)
npm run down                # stop all steward processes
```

Visit `https://yourdomain.com`. Register your first passkey on initial visit — this is the only open-registration window. Adding further devices requires being already signed in.

### Authentication notes

- **First visit:** register your passkey (browser biometric / PIN prompt). Once done the door is closed — subsequent registrations require an active session.
- **Returning:** click "Sign in with Passkey" and authenticate with your device.
- **Logout:** use the sign-out button in the sidebar (desktop) or the header bar (mobile).
- **Fallback:** `API_KEY` bearer token is still accepted during rollout so existing tools keep working. Once all your devices have passkeys, remove `API_KEY` from `.env` and `VITE_API_KEY` from `client/.env.local`.

### Testing

```bash
npm test                    # unit + component tests (~4s, no servers needed)
npm run test:e2e            # E2E smoke tests (auto-starts dev servers)
npm run test:all            # everything
```

---

## Documentation

| Doc | Contents |
|---|---|
| [Architecture](docs/architecture.md) | Repo layout, port map, cross-program interfaces, auth design, shared config and database schema |
| [Server](docs/server.md) | Express routes, session lifecycle, SSE protocol, Claude subprocess gotchas, testing |
| [Client](docs/client.md) | Component tree, state management, SSE client, Vite config, testing |
| [Safe-Mode Core](docs/safe.md) | Emergency terminal internals, freeze policy |
| [Self-Management](docs/self-management.md) | In-app upgrade flow, PM2 process management, nginx dev/prod switching |
| [Roadmap](docs/roadmap.md) | Planned features: scheduler, MCP, Capacitor packaging, mini-app platform |

---

## Project Files

| File | Purpose |
|---|---|
| `MEMORY.md` | Machine-readable context for AI agents resuming this project |
| `TODO.md` | Canonical task list |
| `archived_tasks.md` | Completed items (kept separate to reduce token load) |
| `.env.example` | Environment variable template |
| `ecosystem.config.cjs` | PM2 production process config (`steward-main` + `steward-safe`) |
| `ecosystem.dev.config.cjs` | PM2 dev process config (`steward-server` + `steward-client` + `steward-safe`) |
| `scripts/up.js` | Port conflict check before `pm2 start` (used by `npm run up` and `npm run up:dev`) |
| `scripts/status.js` | `npm run status` — checks all three ports |
