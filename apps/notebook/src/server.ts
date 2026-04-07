import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initDb } from './db.js'
import { cellsRouter } from './routes/cells.js'
import { notebooksRouter } from './routes/notebooks.js'
import { kernelRouter, shutdownKernels } from './routes/kernel.js'
import { chatRouter } from './routes/chat.js'
import { startWatcher } from './watcher.js'
import { broadcastCellUpdate, addSseClient, removeSseClient } from './sse.js'
import { initKernelManager } from './kernels/manager.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Parse argv ────────────────────────────────────────────────────────────────

const port = parseInt(process.argv[2] ?? '', 10)
if (!port || isNaN(port)) {
  console.error('Usage: node dist/server.js <port> [--data-dir <path>]')
  process.exit(1)
}

const dataDirArg = process.argv.indexOf('--data-dir')
const DATA_DIR = dataDirArg !== -1
  ? path.resolve(process.argv[dataDirArg + 1])
  : process.cwd()

// ── Ensure base directory structure ──────────────────────────────────────────

for (const dir of ['notebooks', 'workspace', '.notebook', 'kernels/tmp']) {
  fs.mkdirSync(path.join(DATA_DIR, dir), { recursive: true })
}

// Write port file so .notebook/run_cell.sh can read it dynamically
fs.writeFileSync(path.join(DATA_DIR, '.notebook', 'port'), String(port))

// Copy helper scripts into the data dir's .notebook/ on startup
const helperSrc = path.join(__dirname, '..', '.notebook')
for (const script of ['run_cell.sh', 'run_all.sh']) {
  const src = path.join(helperSrc, script)
  const dst = path.join(DATA_DIR, '.notebook', script)
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst)
    fs.chmodSync(dst, 0o755)
  }
}

// ── Init DB ───────────────────────────────────────────────────────────────────

const { defaultNotebookId } = initDb(path.join(DATA_DIR, 'notebook.db'))

// ── Filesystem migration (single → multi-notebook) ────────────────────────────
// If DB migration created a default notebook, move old flat cells/ → notebooks/{id}/cells/

if (defaultNotebookId) {
  const oldCellsDir = path.join(DATA_DIR, 'cells')
  const newCellsDir = path.join(DATA_DIR, 'notebooks', defaultNotebookId, 'cells')

  if (fs.existsSync(oldCellsDir)) {
    fs.mkdirSync(newCellsDir, { recursive: true })
    const files = fs.readdirSync(oldCellsDir)
    for (const f of files) {
      fs.renameSync(path.join(oldCellsDir, f), path.join(newCellsDir, f))
    }
    try { fs.rmdirSync(oldCellsDir) } catch { /* non-empty, leave it */ }
    console.log(`[server] migrated ${files.length} file(s): cells/ → notebooks/${defaultNotebookId}/cells/`)
  }
}

// ── Init Kernels ──────────────────────────────────────────────────────────────

initKernelManager(DATA_DIR)

// ── Express app ───────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())

// Expose DATA_DIR to route handlers via app.locals
app.locals.dataDir = DATA_DIR

// Routes
app.use('/api', notebooksRouter)
app.use('/api', cellsRouter)
app.use('/api', kernelRouter)
app.use('/api', chatRouter)

// SSE endpoint for cell-update broadcasts (file watcher → clients)
app.get('/api/watch', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  addSseClient(res)
  res.on('close', () => removeSseClient(res))

  // Keepalive ping every 30s
  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n')
  }, 30_000)
  res.on('close', () => clearInterval(ping))
})

// Serve built client in production
const publicDir = path.join(__dirname, '..', 'dist', 'public')
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir))
  // SPA fallback
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'))
  })
}

// ── Start file watcher ────────────────────────────────────────────────────────

startWatcher(path.join(DATA_DIR, 'notebooks'), (cellId, source) => {
  broadcastCellUpdate(cellId, source)
})

// ── Start server ──────────────────────────────────────────────────────────────

app.listen(port, () => {
  console.log(`[notebook] listening on :${port}  data-dir=${DATA_DIR}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  shutdownKernels()
  process.exit(0)
})
process.on('SIGINT', () => {
  shutdownKernels()
  process.exit(0)
})
