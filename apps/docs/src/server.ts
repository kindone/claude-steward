import express from 'express'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { startMkDocs, stopMkDocs } from './mkdocs.js'
import { proxyToMkDocs, proxyWebSocket } from './proxy.js'
import { chatRouter, initChatDb } from './routes/chat.js'
import { fileRouter } from './routes/file.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Parse argv ────────────────────────────────────────────────────────────────

const port = parseInt(process.argv[2] ?? '', 10)
if (!port || isNaN(port)) {
  console.error('Usage: node dist/server.js <port> [--docs-dir <path>]')
  process.exit(1)
}

const docsDirArg = process.argv.indexOf('--docs-dir')
const DOCS_DIR = docsDirArg !== -1
  ? path.resolve(process.argv[docsDirArg + 1])
  : process.cwd()

if (!fs.existsSync(DOCS_DIR)) {
  console.error(`[docs] ERROR: docs directory does not exist: ${DOCS_DIR}`)
  process.exit(1)
}

// ── Init DB ───────────────────────────────────────────────────────────────────

const dbPath = path.join(DOCS_DIR, '.docs-chat.db')
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS docs_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`)
initChatDb(db)

// ── Express app ───────────────────────────────────────────────────────────────

const app = express()
app.use(express.json({ limit: '2mb' }))
app.locals.docsDir = DOCS_DIR

// Static: serve the chat panel assets at fixed paths
const publicDir = path.join(__dirname, '..', 'public')
app.use('/chat-panel.js', express.static(path.join(publicDir, 'chat-panel.js')))
app.use('/chat-panel.css', express.static(path.join(publicDir, 'chat-panel.css')))
app.use('/pikchr-renderer.js', express.static(path.join(publicDir, 'pikchr-renderer.js')))
app.use('/pikchr.js', express.static(path.join(publicDir, 'pikchr.js')))
app.use('/pikchr.wasm', express.static(path.join(publicDir, 'pikchr.wasm')))
// mdart.js is a copy of mdart/packages/mdart/dist/index.js (ESM bundle, ~310KB).
// To refresh after upstream changes: cp ../../mdart/packages/mdart/dist/index.js public/mdart.js
app.use('/mdart.js', express.static(path.join(publicDir, 'mdart.js')))
app.use('/mdart-renderer.js', express.static(path.join(publicDir, 'mdart-renderer.js')))

// API routes
app.use('/api', chatRouter)
app.use('/api', fileRouter)

// Everything else → proxy to MkDocs
app.use(proxyToMkDocs)

// ── HTTP server (needed for WS upgrade handling) ──────────────────────────────

const server = http.createServer(app)

// Proxy WebSocket upgrades (MkDocs live-reload)
server.on('upgrade', (req, socket, head) => {
  proxyWebSocket(req, socket as import('node:stream').Duplex, head)
})

// ── Start MkDocs then listen ──────────────────────────────────────────────────

// Derive a unique internal MkDocs port from the public port so multiple
// docs instances don't collide on the same internal port (e.g. 4002 → 14002).
const mkdocsPort = port + 10000

console.log(`[docs] starting MkDocs in ${DOCS_DIR} on internal port ${mkdocsPort}…`)

startMkDocs(DOCS_DIR, mkdocsPort)
  .then(() => {
    server.listen(port, () => {
      console.log(`[docs] listening on :${port}  docs-dir=${DOCS_DIR}`)
    })
  })
  .catch((err: Error) => {
    console.error(`[docs] failed to start MkDocs: ${err.message}`)
    process.exit(1)
  })

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown() {
  stopMkDocs()
  server.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
