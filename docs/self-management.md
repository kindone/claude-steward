# Self-Management & Safe-Mode

Claude Steward can upgrade itself. The app is one of its own projects — Claude edits source files via chat, builds, and triggers a live reload without any manual deployment step.

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

Separate from the chat SSE stream. The `App` component connects on mount and holds this connection open for the lifetime of the browser session. The server tracks all connections in `server/src/lib/connections.ts` (`Set<Response>`). Current uses:

- `reload` events — upgrade flow
- Future: scheduler notifications, background job status

The `subscribeToAppEvents()` helper in `client/src/lib/api.ts` handles connection, auto-reconnect (3s backoff), and returns an unsubscribe function.

---

## Safe-Mode Core (`safe/`)

A completely independent emergency terminal that survives main app crashes.

### Properties

| Property | Detail |
|---|---|
| **Port** | `:3003` (separate PM2 process) |
| **Dependencies** | Zero — pure Node.js built-ins (`http`, `child_process`, `readline`) |
| **Build step** | None — `node safe/server.js` directly |
| **State** | Stateless; client holds `claudeSessionId` in JS state for session continuity |
| **UI** | Red/orange "⚠ SAFE MODE" theme — unmistakably not the main app |
| **Auth** | Same `API_KEY` bearer token |
| **Permissions** | `--dangerously-skip-permissions` — no interactive prompts |

### PM2 Ecosystem

```
steward-main  (node dist/index.js)   port 3001  ← upgraded via /api/admin/reload
steward-safe  (node safe/server.js)  port 3003  ← frozen, always-on
```

Config lives in `ecosystem.config.cjs` at the monorepo root.

### Freeze Policy

**`safe/` is frozen once stabilized.** It must never be modified, never included in build scripts, and never touched by Claude sessions working on the steward project. Its value is precisely that it is not subject to the upgrade cycle — it is the last-resort tool for recovering from a broken main app.

The files subject to the freeze:
- `safe/server.js`
- `safe/index.html`
- `safe/package.json`
