#!/usr/bin/env node
// Checks which steward processes are reachable on their expected ports / sockets.
import net from 'node:net'
import fs from 'node:fs'
import http from 'node:http'

const RESET  = '\x1b[0m'
const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const BOLD   = '\x1b[1m'
const DIM    = '\x1b[2m'

const MAIN_PORT = 3001
const SAFE_PORT = 3003
const CLIENT_DEV_PORT = 5173
const WORKER_SOCKET = '/tmp/claude-worker.sock'
const APPS_SOCKET = '/tmp/claude-apps.sock'

function checkHost(port, host) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host })
    sock.setTimeout(500)
    sock.on('connect', () => { sock.destroy(); resolve(true) })
    sock.on('error',   () => resolve(false))
    sock.on('timeout', () => { sock.destroy(); resolve(false) })
  })
}

// Some servers bind to IPv6 (::1), others to IPv4 (127.0.0.1) — try both.
async function checkPort(port) {
  const [v4, v6] = await Promise.all([checkHost(port, '127.0.0.1'), checkHost(port, '::1')])
  return v4 || v6
}

// Verify a Unix socket exists AND accepts a connection (covers stale socket files).
function checkSocket(path) {
  return new Promise((resolve) => {
    if (!fs.existsSync(path)) return resolve(false)
    const sock = net.createConnection({ path })
    sock.setTimeout(500)
    sock.on('connect', () => { sock.destroy(); resolve(true) })
    sock.on('error',   () => resolve(false))
    sock.on('timeout', () => { sock.destroy(); resolve(false) })
  })
}

// Probe main server's '/' to see if it serves the SPA bundle (production mode).
// Returns true when the response looks like the built index.html.
function checkSpaServedByMain(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 500 }, (res) => {
      let body = ''
      res.on('data', (chunk) => {
        body += chunk
        if (body.length > 4096) { res.destroy(); resolve(looksLikeSpa(body)) }
      })
      res.on('end', () => resolve(looksLikeSpa(body)))
    })
    req.on('error',   () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

function looksLikeSpa(body) {
  // Vite bundle marker: built index.html references /assets/index-*.js
  return /<script[^>]+src="\/assets\/index-/.test(body) || /<div id="root">/.test(body)
}

console.log(`\n${BOLD}Steward — server status${RESET}\n`)

const [mainUp, safeUp, clientDevUp, workerUp, appsUp] = await Promise.all([
  checkPort(MAIN_PORT),
  checkPort(SAFE_PORT),
  checkPort(CLIENT_DEV_PORT),
  checkSocket(WORKER_SOCKET),
  checkSocket(APPS_SOCKET),
])

// Client status: dev server wins if up; otherwise look for SPA on main.
let clientStatus
if (clientDevUp) {
  clientStatus = { up: true, label: 'client (dev)', detail: `:${CLIENT_DEV_PORT}` }
} else if (mainUp && (await checkSpaServedByMain(MAIN_PORT))) {
  clientStatus = { up: true, label: 'client (served by main)', detail: `:${MAIN_PORT}` }
} else {
  clientStatus = {
    up: false,
    label: 'client',
    detail: '',
    hint: 'npm run dev --workspace=client  OR  npm run build && pm2 restart steward-main',
  }
}

const rows = [
  { label: 'main server',    detail: `:${MAIN_PORT}`,    up: mainUp,   hint: 'npm run dev  OR  npm start' },
  { label: 'worker',         detail: WORKER_SOCKET,      up: workerUp, hint: 'pm2 start steward-worker' },
  { label: 'apps sidecar',   detail: APPS_SOCKET,        up: appsUp,   hint: 'pm2 start steward-apps' },
  { label: 'safe-mode core', detail: `:${SAFE_PORT}`,    up: safeUp,   hint: 'node safe/server.js' },
  clientStatus,
]

for (const { label, detail, up, hint } of rows) {
  const badge   = up ? `${GREEN}● running${RESET}` : `${RED}○ stopped${RESET}`
  const detailStr = detail ? `${DIM}${detail}${RESET}` : ''
  const hintStr = up || !hint ? '' : `  ${YELLOW}→ ${hint}${RESET}`
  console.log(`  ${badge}  ${label} ${detailStr}${hintStr}`)
}

const anyDown = rows.some((r) => !r.up)
console.log(anyDown ? '' : `\n${GREEN}All servers up.${RESET}`)
console.log()
