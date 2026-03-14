# Safe-Mode Core Architecture

The safe-mode core (`safe/`) is a completely independent emergency terminal that survives main app crashes. It has zero dependencies and is intentionally frozen once stabilized.

---

## Properties

| Property | Detail |
|---|---|
| **Port** | `:3003` (separate PM2 process — `steward-safe`) |
| **Dependencies** | Zero — pure Node.js built-ins only (`http`, `child_process`, `readline`, `fs`) |
| **Build step** | None — `node safe/server.js` directly |
| **State** | Stateless; client holds `claudeSessionId` in JS memory for session continuity |
| **UI** | Red/orange "⚠ SAFE MODE" theme — unmistakably not the main app |
| **Auth** | Same `API_KEY` bearer token from `.env` (parsed manually, no dotenv) |
| **Permissions** | `--dangerously-skip-permissions` — no interactive prompts, full file access |

---

## Directory Layout

```
safe/
├── server.js      ← plain Node.js HTTP server (no framework)
├── index.html     ← vanilla JS UI, served inline from server.js
└── package.json   ← { "type": "module" } only — no dependencies
```

---

## Server (`server.js`)

A hand-written HTTP server with two endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Serves `index.html` inline |
| `GET` | `/ping` | Auth check (returns `200` or `401`); no Claude spawn |
| `POST` | `/chat` | Streams Claude output as SSE |

### `.env` parsing

`server.js` has no access to `dotenv`. It reads the `.env` file with a manual line parser (regex per line) to extract `API_KEY` and `SAFE_PORT`.

### Auth and brute-force protection

Every request checks `Authorization: Bearer <token>`. Uses **progressive delays (tar-pitting)** rather than hard lockouts — safe-mode is the last resort, locking it out entirely would be a DoS against the owner.

Delay schedule before returning a `401` response (by prior failure count from that IP):

| Failures so far | Delay before response |
|---|---|
| 0 | 0 ms (instant) |
| 1 | 1 s |
| 2 | 5 s |
| 3 | 15 s |
| 4+ | 30 s |

- Counts reset after 15 minutes of silence
- A successful auth immediately clears the failure record
- `X-Forwarded-For` is only trusted when the direct connection is from loopback (`127.0.0.1` / `::1`), preventing external IP spoofing that could delay a legitimate user
- Stale entries pruned hourly

### Chat endpoint

```
POST /chat  { message, sessionId? }
  │  Set SSE headers (Content-Type: text/event-stream, Cache-Control: no-cache)
  │  Spawn: claude --print <message>
  │                --output-format stream-json
  │                --verbose
  │                --include-partial-messages
  │                --dangerously-skip-permissions
  │                [--resume <sessionId>]
  │  env: CI=true, all CLAUDE* vars stripped
  │
  │  readline on stdout:
  │    result chunk detected → send  event: done  → res.end()
  │    all other lines       → send  event: chunk
  │
  │  child.on('close', code):
  │    if res not ended → send  event: error  with stderr content
  ▼
Client receives SSE and renders output
```

The `result` chunk detection (not `process.on('close')`) is what determines stream completion, matching the main server's behaviour.

---

## Client UI (`index.html`)

Vanilla JavaScript, no build step, served directly from `server.js`. Red/orange colour scheme makes it visually distinct.

### Auto-login

On page load the client checks `localStorage` for a stored API key and probes `GET /ping`. If the ping returns 200, the chat UI is shown immediately without requiring the user to re-enter the key.

### Tool activity display

When Claude uses a tool during a response, the UI shows activity inline:

```
⚙ Write…          ← content_block_start with type: tool_use
✓ Write: created   ← user chunk with tool_result
```

This is important for safe-mode because Claude frequently writes files and runs commands. Without this feedback, a response with only tool use would appear empty.

### Session continuity

The client holds `claudeSessionId` (from the `system.init` chunk) in a JS variable. Subsequent messages in the same page session include it in the POST body to use `--resume`. Refreshing the page starts a new Claude session.

### Console logging

All client activity is prefixed with `[safe]` and uses structured log levels (`log.info`, `log.warn`, `log.error`, `log.chunk`) for easier debugging in the browser console.

---

## Freeze Policy

**`safe/` must not be modified once stabilized.** Its value depends on being outside the upgrade cycle — it is the last-resort tool for recovering from a broken main app.

Rules:
- Never modify `safe/server.js`, `safe/index.html`, or `safe/package.json`
- Never include `safe/` in build scripts (`npm run build` must not touch it)
- Never run Claude sessions that target the `safe/` directory as their working directory
- If a bug is found in safe-mode, fix it manually and re-freeze

The `safe/` directory is explicitly excluded from the main server's static file serving.
