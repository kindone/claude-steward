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

## PM2 Ecosystem

Two independent processes defined in `ecosystem.config.cjs`:

```
steward-main  (node dist/index.js)   port 3001  ← upgraded via /api/admin/reload
steward-safe  (node safe/server.js)  port 3003  ← frozen, see safe.md
```

`steward-main` restarts automatically on `process.exit(0)` (clean exit), picking up the newly built `dist/`. `steward-safe` is a completely separate process and is unaffected by main app restarts.
