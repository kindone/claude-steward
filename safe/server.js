/**
 * SAFE-MODE CORE — DO NOT MODIFY AFTER STABILIZATION
 *
 * Emergency terminal providing direct claude CLI access when the main app is
 * unavailable. Zero npm dependencies; runs with plain `node safe/server.js`.
 *
 * Env vars (loaded from ../.env manually):
 *   API_KEY      — bearer token (required)
 *   SAFE_PORT    — port to listen on (default 3003)
 *   CLAUDE_PATH  — path to claude binary (default ~/.local/bin/claude)
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Manually parse ../.env so we need no dotenv dependency
function loadEnv(envPath) {
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
  } catch { /* .env is optional */ }
}
loadEnv(path.join(__dirname, '../.env'))

const PORT = parseInt(process.env.SAFE_PORT ?? '3003', 10)
const API_KEY = process.env.API_KEY ?? ''
const CLAUDE_BIN = process.env.CLAUDE_PATH ?? `${process.env.HOME ?? '/usr/local'}/.local/bin/claude`
const INDEX_HTML = path.join(__dirname, 'index.html')

// ── Brute-force protection (progressive delays / tar-pitting) ─────────────────
//
// Never hard-locks — safe-mode is the last resort, locking it out creates a DoS.
// Instead, each consecutive failure from the same IP waits longer before getting
// a response.  Brute-forcing a 32-char key becomes astronomically slow.
//
// X-Forwarded-For is only trusted from loopback (a real local reverse proxy).
// An external attacker cannot spoof it to delay/block a legitimate user.

// Delay applied before responding to failure N (0-indexed):
//   0 failures prior → respond instantly, 1 → 1 s, 2 → 5 s, 3 → 15 s, 4+ → 30 s
const DELAY_SCHEDULE_MS = [0, 1_000, 5_000, 15_000, 30_000]
const WINDOW_MS = 15 * 60 * 1000   // rolling window; count resets after silence

// Map<ip, { count, windowStart }>
const authAttempts = new Map()

// Prune stale entries hourly
setInterval(() => {
  const now = Date.now()
  for (const [ip, rec] of authAttempts) {
    if (now - rec.windowStart > WINDOW_MS) authAttempts.delete(ip)
  }
}, 60 * 60 * 1000).unref()

function clientIp(req) {
  const remote = req.socket.remoteAddress ?? ''
  // Only trust X-Forwarded-For when the direct connection is from loopback
  const isLocalProxy = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
  if (isLocalProxy) {
    const fwd = req.headers['x-forwarded-for']
    if (fwd) return fwd.split(',')[0].trim()
  }
  return remote
}

function failureDelay(ip) {
  const now = Date.now()
  const rec = authAttempts.get(ip)
  if (!rec || now - rec.windowStart > WINDOW_MS) return 0
  return DELAY_SCHEDULE_MS[Math.min(rec.count, DELAY_SCHEDULE_MS.length - 1)]
}

function recordFailure(ip) {
  const now = Date.now()
  let rec = authAttempts.get(ip)
  if (!rec || now - rec.windowStart > WINDOW_MS) rec = { count: 0, windowStart: now }
  rec.count++
  authAttempts.set(ip, rec)
  if (rec.count > 1) console.warn(`[safe-mode] Auth failure #${rec.count} from ${ip} (delay ${failureDelay(ip)}ms next)`)
}

function clearFailures(ip) { authAttempts.delete(ip) }

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

function send(res, status, contentType, body) {
  res.writeHead(status, { 'Content-Type': contentType })
  res.end(body)
}

async function requireAuth(req, res) {
  const ip = clientIp(req)
  const delay = failureDelay(ip)
  if (delay > 0) await sleep(delay)

  const auth = req.headers['authorization'] ?? ''
  if (!API_KEY || auth !== `Bearer ${API_KEY}`) {
    recordFailure(ip)
    send(res, 401, 'application/json', JSON.stringify({ error: 'Unauthorized' }))
    return false
  }

  clearFailures(ip)
  return true
}

// Spawn the claude CLI and pipe NDJSON output back as SSE.
// Strip CLAUDE* env vars to prevent IPC hang when run inside a Claude Code session.
async function handleChat(req, res) {
  if (!await requireAuth(req, res)) return

  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    let message, claudeSessionId
    try {
      const parsed = JSON.parse(body)
      message = parsed.message
      claudeSessionId = parsed.claudeSessionId ?? null
    } catch {
      send(res, 400, 'application/json', JSON.stringify({ error: 'Invalid JSON' }))
      return
    }
    if (!message) {
      send(res, 400, 'application/json', JSON.stringify({ error: 'message is required' }))
      return
    }

    const args = [
      '--print', message,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
    ]
    if (claudeSessionId) args.push('--resume', claudeSessionId)

    // Strip all CLAUDE* vars — inheriting CLAUDECODE=1 causes the subprocess
    // to hang waiting for IPC from a parent session that does not exist.
    const cleanEnv = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (!k.startsWith('CLAUDE') && k !== 'ANTHROPIC_BASE_URL' && k !== 'ANTHROPIC_API_KEY') cleanEnv[k] = v
    }
    if (process.env.ANTHROPIC_BASE_URL) cleanEnv.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL

    const child = spawn(CLAUDE_BIN, args, {
      env: { ...cleanEnv, CI: 'true' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    })

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    let stderrOutput = ''

    rl.on('line', line => {
      if (!line.trim()) return
      let chunk
      try { chunk = JSON.parse(line) } catch { return }

      res.write(`event: chunk\ndata: ${line}\n\n`)

      // Close on the result chunk, same as the main app.
      // If claude flagged an error (e.g. API auth failure), surface it as an error event
      // so the UI shows it instead of silently showing an empty response.
      if (chunk.type === 'result') {
        if (chunk.is_error && chunk.result) {
          res.write(`event: error\ndata: ${JSON.stringify({ message: chunk.result })}\n\n`)
        }
        res.write(`event: done\ndata: {}\n\n`)
        res.end()
      }
    })

    child.stderr.on('data', d => { stderrOutput += d.toString() })

    child.on('error', err => {
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`)
        res.end()
      }
    })

    // Only fires if the response wasn't already closed by the result chunk.
    // This covers genuine failures where claude exits before producing a result.
    child.on('close', code => {
      if (!res.writableEnded) {
        const detail = stderrOutput.trim() || `exit code ${code}`
        res.write(`event: error\ndata: ${JSON.stringify({ message: `claude failed: ${detail}` })}\n\n`)
        res.write(`event: done\ndata: {}\n\n`)
        res.end()
      }
    })

    res.on('close', () => { if (!child.killed) child.kill('SIGTERM') })
  })
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST' })
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/') {
    try {
      send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(INDEX_HTML, 'utf8'))
    } catch {
      send(res, 500, 'text/plain', 'index.html not found')
    }
    return
  }

  if (req.method === 'GET' && req.url === '/ping') {
    if (!await requireAuth(req, res)) return
    send(res, 200, 'application/json', JSON.stringify({ ok: true }))
    return
  }

  if (req.method === 'POST' && req.url === '/chat') {
    handleChat(req, res)
    return
  }

  send(res, 404, 'text/plain', 'Not found')
})

server.listen(PORT, () => {
  console.log(`claude-steward SAFE MODE running on http://localhost:${PORT}`)
})
