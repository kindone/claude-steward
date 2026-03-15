#!/usr/bin/env node
// Starts Claude Steward in the given mode (dev or prod) via PM2.
// Checks for port conflicts first and prints a clear error if any are detected.
import net from 'node:net'
import { execSync } from 'node:child_process'

const mode = process.argv[2]

if (mode !== 'dev' && mode !== 'prod') {
  console.error('Usage: node scripts/up.js [dev|prod]')
  process.exit(1)
}

const RESET  = '\x1b[0m'
const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const BOLD   = '\x1b[1m'
const DIM    = '\x1b[2m'

const PORTS = {
  dev: [
    { port: 3001, name: 'main server'    },
    { port: 3003, name: 'safe-mode core' },
    { port: 5173, name: 'client (dev)'   },
  ],
  prod: [
    { port: 3001, name: 'main server'    },
    { port: 3003, name: 'safe-mode core' },
  ],
}

const ECOSYSTEM = {
  dev:  'ecosystem.dev.config.cjs',
  prod: 'ecosystem.config.cjs',
}

function checkHost(port, host) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host })
    sock.setTimeout(500)
    sock.on('connect',  () => { sock.destroy(); resolve(true)  })
    sock.on('error',    () =>                   resolve(false) )
    sock.on('timeout',  () => { sock.destroy(); resolve(false) })
  })
}

// Some servers bind to IPv6 (::1), others to IPv4 (127.0.0.1) — try both.
async function checkPort(port) {
  const [v4, v6] = await Promise.all([checkHost(port, '127.0.0.1'), checkHost(port, '::1')])
  return v4 || v6
}

console.log(`\n${BOLD}Claude Steward — starting (${mode})${RESET}\n`)

const results = await Promise.all(
  PORTS[mode].map(async (p) => ({ ...p, occupied: await checkPort(p.port) }))
)

const conflicts = results.filter((r) => r.occupied)

if (conflicts.length > 0) {
  console.error(`${RED}${BOLD}Port conflict — cannot start:${RESET}\n`)
  for (const { name, port } of conflicts) {
    console.error(`  ${RED}✗${RESET}  :${port}  ${DIM}(${name})${RESET}  is already in use`)
  }
  console.error(
    `\n${YELLOW}Stop all steward processes first:${RESET}  ${BOLD}npm run down${RESET}\n` +
    `${DIM}Then run  npm run up:${mode}  again.${RESET}\n`
  )
  process.exit(1)
}

execSync(`pm2 start ${ECOSYSTEM[mode]}`, { stdio: 'inherit' })
console.log(`\n${GREEN}${BOLD}All processes started.${RESET}  Run ${BOLD}npm run status${RESET} to verify.\n`)
