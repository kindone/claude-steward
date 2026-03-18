import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
import { createApp } from './app.js'
import { projectQueries, migrateOrphanedSessions } from './db/index.js'
import { workerClient } from './worker/client.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// .env lives in the monorepo root (two levels up from server/src/)
dotenv.config({ path: path.join(__dirname, '../../.env') })

const APP_ROOT = path.resolve(__dirname, '../..')

// Auto-seed the steward project on fresh installs / new hosts.
// Idempotent: skipped if a project already points at APP_ROOT.
const stewardExists = projectQueries.list().some(p => p.path === APP_ROOT)
if (!stewardExists) {
  projectQueries.create(randomUUID(), 'claude-steward', APP_ROOT)
  console.log(`[db] seeded steward project → ${APP_ROOT}`)
}

migrateOrphanedSessions(APP_ROOT)

// Begin connecting to the Claude worker. Falls back to direct spawn if unavailable.
workerClient.connect()

const PORT = parseInt(process.env.PORT ?? '3001', 10)

const app = createApp()
app.listen(PORT, () => {
  console.log(`claude-steward server running on http://localhost:${PORT}`)
})
