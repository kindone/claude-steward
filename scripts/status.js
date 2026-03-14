#!/usr/bin/env node
// Checks which claude-steward processes are reachable on their expected ports.
import net from 'node:net'

const SERVERS = [
  { name: 'main server',    port: 3001, hint: 'npm run dev  OR  npm start' },
  { name: 'safe-mode core', port: 3003, hint: 'node safe/server.js' },
  { name: 'client (dev)',   port: 5173, hint: 'npm run dev --workspace=client' },
]

const RESET  = '\x1b[0m'
const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const BOLD   = '\x1b[1m'
const DIM    = '\x1b[2m'

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

console.log(`\n${BOLD}Claude Steward — server status${RESET}\n`)

const results = await Promise.all(
  SERVERS.map(async (s) => ({ ...s, up: await checkPort(s.port) }))
)

for (const { name, port, hint, up } of results) {
  const badge  = up ? `${GREEN}● running${RESET}` : `${RED}○ stopped${RESET}`
  const portStr = `${DIM}:${port}${RESET}`
  const hintStr = up ? '' : `  ${YELLOW}→ ${hint}${RESET}`
  console.log(`  ${badge}  ${name} ${portStr}${hintStr}`)
}

const anyDown = results.some((r) => !r.up)
console.log(anyDown ? '' : `\n${GREEN}All servers up.${RESET}`)
console.log()
