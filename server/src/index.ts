import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
import { createApp } from './app.js'
import { projectQueries, migrateOrphanedSessions } from './db/index.js'
import { workerClient } from './worker/client.js'
import { recoverStreamingSessions } from './worker/recovery.js'
import { startScheduler } from './lib/scheduler.js'
import { appsClient } from './apps/client.js'
import { appSlotQueries } from './db/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// .env lives in the monorepo root (two levels up from server/src/ or server/dist/)
dotenv.config({ path: path.join(__dirname, '../../.env') })

const APP_ROOT = path.resolve(__dirname, '../..')

// ---------------------------------------------------------------------------
// Startup env validation — loud warnings, no crashes
// ---------------------------------------------------------------------------
;(function validateEnv() {
  const warn = (msg: string) => console.warn(`[config] WARN ${msg}`)

  const domain = process.env.APP_DOMAIN
  if (!domain) {
    warn('APP_DOMAIN is not set — WebAuthn and push notifications will only work on localhost')
  } else if (domain === 'example.com' || domain.includes('placeholder')) {
    warn(`APP_DOMAIN looks like a placeholder ("${domain}") — update it in .env`)
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    warn('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY missing — web push notifications are disabled')
  }
})()
// ---------------------------------------------------------------------------

// Auto-seed the steward project on fresh installs / new hosts.
// Idempotent: skipped if a project already points at APP_ROOT.
const stewardExists = projectQueries.list().some(p => p.path === APP_ROOT)
if (!stewardExists) {
  projectQueries.create(randomUUID(), 'claude-steward', APP_ROOT)
  console.log(`[db] seeded steward project → ${APP_ROOT}`)
}

migrateOrphanedSessions(APP_ROOT)

// Begin connecting to the Claude worker. Falls back to direct spawn if unavailable.
// On each (re)connect, attempt to recover any in-flight sessions before marking
// remaining streaming rows as interrupted.
workerClient.onReconnected = recoverStreamingSessions
workerClient.connect()

// Connect to the apps sidecar. On reconnect, reconcile DB slots with what the
// sidecar actually has running. If the sidecar was restarted it will report an
// empty list — slots that are 'running'/'starting' in the DB but absent from
// the sidecar are marked error. Slots that ARE present are left untouched,
// which correctly handles HTTP-server-only restarts where the sidecar never died.
appsClient.onReconnected = () => {
  appsClient.status().then((statusReply) => {
    const liveIds = new Set(statusReply.apps.map((a) => a.configId))
    const slots = appSlotQueries.listAll()
    for (const slot of slots) {
      if ((slot.status === 'running' || slot.status === 'starting') && slot.config_id) {
        if (!liveIds.has(slot.config_id)) {
          appSlotQueries.markError(slot.slot, 'sidecar restarted')
        }
      }
    }
  }).catch((err: unknown) => {
    console.warn('[apps] failed to sync slots on reconnect:', err)
    // Fallback: if we can't query the sidecar, assume it restarted and clear stale slots
    appSlotQueries.resetStale()
  })
}
appsClient.onCrashed = (configId, _exitCode) => {
  const slot = appSlotQueries.findByConfigId(configId)
  // Guard: don't overwrite an intentional 'stopped' state (shouldn't normally
  // happen since the sidecar removes from its map before killing, but be safe).
  if (slot && slot.status !== 'stopped') {
    appSlotQueries.markError(slot.slot, 'process exited unexpectedly')
  }
}
appsClient.connect()

startScheduler()

const PORT = parseInt(process.env.PORT ?? '3001', 10)

const app = createApp()
app.listen(PORT, () => {
  console.log(`claude-steward server running on http://localhost:${PORT}`)
})
