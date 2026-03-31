# Apps Sidecar

The `steward-apps` process manages mini-app child processes (MkDocs, Vite, etc.) independently of the HTTP server lifecycle. Apps keep running when the server hot-reloads, crashes, or is in dev watch mode.

---

## Design Principles

- **Sidecar = dumb process manager** — no DB access, no business logic. Receives commands, spawns/kills OS processes, replies with status.
- **Server = brain** — owns all DB writes (CRUD for `app_configs`, slot assignment, status tracking). Tells the sidecar what to run.
- **Independence** — apps are children of the sidecar, not the HTTP server. Server restart = apps unaffected.
- **Always use the HTTP API** — never send commands directly to the sidecar socket. Only the server knows the UUID `configId` from the DB; bypassing the API creates state divergence (sidecar has a friendly string key, DB has a UUID, resulting in a phantom `crashed` event).

This mirrors the worker architecture: the sidecar holds the process lifecycle, the server handles persistence and API.

---

## Slot Model

10 fixed slots are pre-seeded in `app_slots` at DB creation. Each slot maps to a reserved port:

| Slot | Port | URL |
|---|---|---|
| 1 | 4001 | `https://app1.steward.jradoo.com` |
| 2 | 4002 | `https://app2.steward.jradoo.com` |
| … | … | … |
| 10 | 4010 | `https://app10.steward.jradoo.com` |

nginx proxies `app{N}.steward.jradoo.com → 127.0.0.1:400N` using a wildcard TLS cert (`*.steward.jradoo.com`). Ports are always open; a 502 means nothing is running on that slot.

A **config** (`app_configs`) is a definition — name, command template, work dir. It can exist without a slot.
A **slot** is a running instance — holds a pid and a port. Claiming a slot = start; releasing = stop.

Maximum 10 configs (matches slot count). At most 10 running simultaneously.

---

## Socket Protocol

Transport: Unix domain socket at `/tmp/claude-apps.sock`.
Framing: newline-delimited JSON (NDJSON).
Pattern: **request/reply** — each command from the server gets exactly one reply. The sidecar also broadcasts unsolicited `crashed` events.

### Commands (server → sidecar)

```json
{ "type": "start", "configId": "uuid", "port": 4001, "command": "mkdocs serve --dev-addr 0.0.0.0:4001", "workDir": "/path/to/project" }
{ "type": "stop",  "configId": "uuid" }
{ "type": "status" }
```

- `command` is fully resolved — the server substitutes `{port}` before sending. The sidecar receives a plain shell command.
- `stop` is idempotent: safe to call if the process is already dead.

### Replies (sidecar → server)

```json
{ "type": "started",  "configId": "uuid", "pid": 12345 }
{ "type": "stopped",  "configId": "uuid" }
{ "type": "error",    "configId": "uuid", "error": "spawn failed — no pid" }
{ "type": "status",   "apps": [{ "configId": "uuid", "port": 4001, "pid": 12345, "uptimeMs": 30000 }] }
{ "type": "crashed",  "configId": "uuid", "exitCode": 1 }   ← broadcast on unexpected exit
```

---

## AppsClient

`server/src/apps/client.ts` — the server's connection to the sidecar. Maintains a persistent Unix socket connection with automatic reconnection (3s delay).

Unlike `WorkerClient` (which uses a subscription model for long-running streams), `AppsClient` uses **request/reply**: each command waits for the correlated reply with a 10s timeout.

```ts
appsClient.connect()                         // call once on startup
appsClient.isConnected()                     // before sending commands
await appsClient.start(configId, port, cmd, workDir)  // → StartedReply
await appsClient.stop(configId)              // → StoppedReply
await appsClient.status()                    // → StatusReply
appsClient.onCrashed = (configId, exitCode) => { ... }  // handle unexpected exits
```

Crash handling: the server registers `appsClient.onCrashed` to update the DB slot to `error` state when the sidecar reports an unexpected child exit.

---

## API Routes

Mounted at `/api` in `app.ts` (behind `requireAuth`):

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects/:id/apps` | List configs for a project (includes slot/status) |
| `POST` | `/api/projects/:id/apps` | Create config (`name`, `command_template`, `work_dir`) |
| `PATCH` | `/api/apps/:configId` | Update config (must be stopped) |
| `DELETE` | `/api/apps/:configId` | Delete config (must be stopped) |
| `POST` | `/api/apps/:configId/start` | Claim free slot → tell sidecar → mark running |
| `POST` | `/api/apps/:configId/stop` | Tell sidecar → release slot |
| `GET` | `/api/apps/slots` | All 10 slot states |

`command_template` must contain `{port}` — validated at create/update time. The server substitutes the actual port before sending to the sidecar.

---

## Lifecycle

### Normal start
```
POST /api/apps/:id/start
  → find free slot (lowest slot where config_id IS NULL)
  → compute port = 4000 + slot
  → resolve command: template.replace('{port}', port)
  → appSlotQueries.assign(slot, configId)   ← status = 'starting'
  → appsClient.start(...)
  → appSlotQueries.markRunning(slot, pid)   ← status = 'running'
  → return { slot, port, pid, url }
```

### Normal stop
```
POST /api/apps/:id/stop
  → appsClient.stop(configId)
  → appSlotQueries.markStopped(slot)        ← config_id = NULL, status = 'stopped'
```

### Unexpected crash
```
child process exits unexpectedly
  → sidecar removes from in-memory map
  → sidecar broadcasts { type: 'crashed', configId, exitCode }
  → appsClient.onCrashed fires on server
  → appSlotQueries.markError(slot, 'process exited unexpectedly')
```

### Sidecar restart
All child processes die. On reconnect, the server should call `appSlotQueries.resetStale()` to clear any `starting`/`running` slots back to `stopped` — analogous to `markStaleStreamingMessages()` in the worker. (Registered as `appsClient.onReconnected` hook — not yet implemented; left as a TODO.)

### Process group killing
The sidecar spawns with `detached: true`, which puts the child in its own process group. On stop/crash, the sidecar calls `process.kill(-pgid, 'SIGTERM')` (note the negative PID = PGID) to kill the entire group — `sh` wrapper plus all its descendants (e.g. mkdocs + its Python subprocess). Without this, killing the `sh` wrapper would orphan child processes that keep the port bound. Falls back to `child.kill()` if the PGID kill throws. Force-SIGKILL fires after 5s if SIGTERM doesn't work.

---

## File Layout

```
server/src/apps/
  protocol.ts   — socket path constant + all IPC TypeScript types
  sidecar.ts    — standalone daemon (PM2 entry point)
  client.ts     — AppsClient used by the HTTP server
server/src/routes/
  apps.ts       — all HTTP API handlers
server/src/db/index.ts
  app_configs   — config CRUD queries
  app_slots     — slot assignment queries
```

---

## PM2

| Process | Script | Socket |
|---|---|---|
| `steward-apps` (prod) | `server/dist/apps/sidecar.js` | `/tmp/claude-apps.sock` |
| `steward-apps` (dev) | `npx tsx watch server/src/apps/sidecar.ts` | `/tmp/claude-apps.sock` |

To start/restart the sidecar independently:
```bash
pm2 start ecosystem.config.cjs --only steward-apps
pm2 restart steward-apps --update-env
```
