# Self-Management

Claude Steward can upgrade itself. The app is one of its own projects — Claude edits source files via chat, builds, and triggers a live reload without any manual deployment step.

For the emergency fallback, see [Safe-Mode Core](safe.md).

---

## Upgrade Flow

```
Claude (in steward project session):
  1. Edits source files via chat
  2. Runs: npm run build
  3. Build succeeds → calls POST /api/admin/reload
  ↓
Server (admin.ts):
  1. Broadcasts  event: reload  to all /api/events connections
  2. Waits 200ms
  3. process.exit(0)
  ↓
PM2:
  Detects clean exit → restarts node dist/index.js with new code
  ↓
Clients (having received reload event):
  Show "Restarting…" overlay
  setTimeout(() => window.location.reload(), 1500)
  → reconnect to the new version
```

---

## App-Level SSE Stream (`/api/events`)

Separate from the chat SSE stream. The `App` component connects on mount and holds this connection open for the lifetime of the browser session.

The server tracks all open connections in `server/src/lib/connections.ts` (`Set<Response>`). `broadcastEvent(name, data)` fans out to every connected client.

Current uses:
- `reload` — triggers the client-side page reload after an upgrade

Planned:
- Scheduler notifications (remind-me messages)
- Background job status

The `subscribeToAppEvents()` helper in `client/src/lib/api.ts` handles connection setup, auto-reconnect (3-second backoff on unexpected drop), and returns an unsubscribe function.

---

## Process Management (PM2)

Both dev and production modes are managed through PM2 for stability — processes survive SSH disconnects and restart automatically on crash or clean exit.

### Starting and stopping

```
npm run up        # start production  (conflict check → pm2 start ecosystem.config.cjs)
npm run up:dev    # start dev mode    (conflict check → pm2 start ecosystem.dev.config.cjs)
npm run down      # stop all steward processes
npm run logs      # tail all PM2 logs
npm run restart   # pm2 restart all
npm run status    # check which ports are up
```

**Applying ecosystem config changes** — PM2 caches process env in its internal store; `pm2 restart` reads from that cache, not from the ecosystem file. When you edit an ecosystem file (e.g. changing `DATABASE_PATH`, `PORT`, `APP_DOMAIN`), do a full cycle to force PM2 to re-read it:

```bash
npm run down
pm2 cleardump    # wipes ~/.pm2/dump.pm2 so old env doesn't survive the restart
npm run up       # or npm run up:dev
```

A plain `npm run down && npm run up` is usually sufficient. Only add `pm2 cleardump` if the old env is still showing up in `pm2 env <id>` after the restart.

`npm run up` and `npm run up:dev` run `scripts/up.js` first, which checks each required port before handing off to PM2. If any port is already in use it prints the conflict and exits cleanly:

```
Port conflict — cannot start:

  ✗  :3001  (main server)  is already in use

Stop all steward processes first:  npm run down
Then run  npm run up:dev  again.
```

`npm run down` targets process names explicitly so it won't affect unrelated PM2 processes on the same machine.

### Ecosystem files

**`ecosystem.config.cjs`** — production (two processes):

```
steward-main  (node dist/index.js)   port 3001  ← upgraded via /api/admin/reload
steward-safe  (node safe/server.js)  port 3003  ← frozen, see safe.md
```

**`ecosystem.dev.config.cjs`** — development (three processes):

```
steward-server  (npm run dev --workspace=server)  port 3002  ← tsx watch, auto-reloads on file changes
steward-client  (npm run dev --workspace=client)  port 5173  ← Vite HMR dev server
steward-safe    (node safe/server.js)             port 3003  ← frozen, same as production
```

**How dev HMR works through nginx:**
nginx proxies `dev.steward.yourdomain.com → :5173` (Vite dev server). WebSocket upgrade headers (`Upgrade`, `Connection`) are forwarded via the `$connection_upgrade` map in `/etc/nginx/conf.d/ws-map.conf`, so HMR works end-to-end over HTTPS/WSS. Vite proxies `/api → :3002` internally (configured in `vite.config.ts`), so API calls are transparent.

### Upgrade flow in dev mode

The self-upgrade path (`POST /api/admin/reload` → `process.exit(0)`) still works in dev:
- PM2 restarts `steward-server` after the clean exit; `tsx watch` picks up any file changes.
- Client changes: Vite HMR pushes module updates instantly — no page refresh needed.
- `steward-safe` is unaffected in both modes.

### Surviving reboots

```
pm2 save && pm2 startup
```

Run once after the first `npm run up` or `npm run up:dev` to persist the process list across reboots.

---

## nginx Reverse Proxy

nginx sits in front of both domains and handles TLS termination. Configs live in `/etc/nginx/sites-available/`.

| Domain | nginx config | Upstream |
|---|---|---|
| `steward.yourdomain.com` | `steward` | `:3001` (prod `steward-main`) |
| `dev.steward.yourdomain.com` | `steward-dev` | `:5173` (Vite HMR dev server; proxies `/api` to `:3002`) |
| `safe.steward.yourdomain.com` | `steward-safe` | `:3003` (always) |

Both main and safe domains have Let's Encrypt certs (auto-renewing via certbot systemd timer).

### Enabling the dev subdomain (optional)

To run dev and production at the same time (prod at `steward.yourdomain.com`, dev at `dev.steward.yourdomain.com`):

1. **DNS:** Add an A record for `dev.steward.yourdomain.com` pointing at your server IP.

2. **Install the dev nginx config:**
   ```bash
   sudo cp config/nginx-dev.steward.conf /etc/nginx/sites-available/steward-dev
   # If the repo path differs, use the path to config/nginx-dev.steward.conf from repo root.
   sudo ln -sf /etc/nginx/sites-available/steward-dev /etc/nginx/sites-enabled/
   ```

3. **Get a TLS cert:**
   ```bash
   sudo certbot --nginx -d dev.steward.yourdomain.com
   ```

4. **Reload nginx:**
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

5. **Start dev:** `npm run up:dev` (Vite on :5173). Prod can stay on `npm run up` (main on :3001). Then open `https://dev.steward.yourdomain.com` for dev and `https://steward.yourdomain.com` for prod.

The config file is in the repo at `config/nginx-dev.steward.conf`; it proxies to `127.0.0.1:5173` and includes WebSocket upgrade for Vite HMR.

### Switching between dev and production

**Dev → production:**

```bash
# 1. Build the client into server/public/
npm run build

# 2. Switch PM2 to production processes
npm run down
npm run up           # starts steward-main (:3001) + steward-safe (:3003)

# 3. Point nginx at :3001 instead of :5173
sudo sed -i 's|proxy_pass http://127.0.0.1:5173|proxy_pass http://127.0.0.1:3001|' \
  /etc/nginx/sites-available/steward
sudo systemctl reload nginx

# 4. Set NODE_ENV in .env
# Change NODE_ENV=development → NODE_ENV=production
```

**Production → dev:**

```bash
# 1. Switch PM2 to dev processes
npm run down
npm run up:dev       # starts steward-server (:3001) + steward-client (:5173) + steward-safe (:3003)

# 2. Point nginx back at :5173
sudo sed -i 's|proxy_pass http://127.0.0.1:3001|proxy_pass http://127.0.0.1:5173|' \
  /etc/nginx/sites-available/steward
sudo systemctl reload nginx
```

---

## Remote Debugging via `/api/eval`

The eval relay lets Claude run JavaScript in the user's browser and read the result — invaluable for diagnosing mobile-only issues where a desktop console isn't available.

### How it works

```
Claude → POST /api/eval { code }
  ↓
Server broadcasts SSE event: eval { id, code }
  ↓
Browser executes eval(code), awaits Promises (≤8s)
  ↓
Browser POSTs result back to /api/eval/:id/result
  ↓
Server resolves the pending long-poll → returns result to Claude
```

Auth: session cookie or `Authorization: Bearer <API_KEY>`. The browser-side handler runs automatically (registered in `api.ts`'s `handleEval`).

### Playbook: diagnosing issues on mobile

When a bug only reproduces on the user's phone and you can't access the browser console:

1. **Store debug data on `window`** — instrument the code to write diagnostics to a global (e.g. `window.__scrollDebug = [...]`). This survives across eval calls.

2. **Deploy the instrumented build** — `npm run build` → `POST /api/admin/reload`.

3. **Ask the user to reproduce** — navigate to the problematic view, trigger the bug.

4. **Read the data via eval:**
   ```bash
   curl -s -X POST http://localhost:3001/api/eval \
     --cookie "sid=<token>" \
     -H "Content-Type: application/json" \
     -d '{"code": "JSON.stringify(window.__scrollDebug)"}'
   ```

5. **Query live DOM state:**
   ```bash
   # Get scroll container dimensions
   curl ... -d '{"code": "const c = document.querySelector(\".overflow-y-auto\"); JSON.stringify({ scrollHeight: c.scrollHeight, scrollTop: c.scrollTop, clientHeight: c.clientHeight })"}'

   # Count rendered mermaid diagrams
   curl ... -d '{"code": "document.querySelectorAll(\".mermaid-rendered\").length"}'

   # Remove a debug overlay that's blocking the UI
   curl ... -d '{"code": "document.querySelector(\"div[style*=\\\"z-index:99999\\\"]\")?.remove(); \"done\""}'
   ```

6. **Clean up** — remove the `window.__*` instrumentation and redeploy.

### Tips

- **Don't block the UI** — avoid `alert()` or overlays that cover navigation (the user can't dismiss them without eval access). Use `window.__*` globals instead.
- **Eval timeout is 10s server-side, 8s browser-side** — keep expressions fast.
- **Session cookie required** — the eval endpoint uses the same auth as all `/api` routes. Grab a valid `sid` token from the `auth_sessions` table if needed.
- **Only one browser receives the eval** — if the user has multiple tabs, the first one to respond wins. The eval SSE is broadcast to all connected clients.

---

### Verifying nginx config before reload

```bash
sudo nginx -t                  # syntax check
sudo systemctl reload nginx    # graceful reload (zero downtime)
```

### Manual edits

The steward config is at `/etc/nginx/sites-available/steward`. The only line that changes between modes is the `proxy_pass` upstream. Everything else (TLS, SSE settings, WebSocket upgrade) stays the same regardless of mode.
