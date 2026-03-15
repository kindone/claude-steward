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
steward-server  (npm run dev --workspace=server)  port 3001  ← tsx watch, auto-reloads on file changes
steward-client  (npm run dev --workspace=client)  port 5173  ← Vite HMR
steward-safe    (node safe/server.js)             port 3003  ← frozen, same as production
```

### Upgrade flow in dev mode

The self-upgrade path (`POST /api/admin/reload` → `process.exit(0)`) still works in dev:
- PM2 restarts `steward-server` after the clean exit; `tsx watch` picks up any file changes.
- Client changes are handled by Vite HMR and don't require a restart at all.
- `steward-safe` is unaffected in both modes.

### Surviving reboots

```
pm2 save && pm2 startup
```

Run once after the first `npm run up` or `npm run up:dev` to persist the process list across reboots.
