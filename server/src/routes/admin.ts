import { Router } from 'express'
import { spawn } from 'node:child_process'
import { broadcastEvent } from '../lib/connections.js'

const router = Router()

// Startup timestamp used as a version token — clients can detect when
// a new server instance has started after a reload.
const startedAt = Date.now()

router.get('/version', (_req, res) => {
  res.json({ version: startedAt })
})

// Trigger a graceful hot-swap: broadcast reload to all connected browsers,
// then exit so PM2/systemd restarts with the newly built dist/.
// Intended to be called by the assistant after a successful `npm run build`.
router.post('/reload', (_req, res) => {
  res.json({ ok: true, message: 'Reload broadcast sent. Server restarting…' })
  broadcastEvent('reload', { version: startedAt })
  setTimeout(() => process.exit(0), 200)
})

// Restart steward-worker with graceful drain. Safe to call from a chat
// session running through the worker — the worker drains in-flight jobs
// (up to 60s, gated by PM2 kill_timeout=90s) so the streaming response can
// finish writing to the DB before exit. Browser SSE reconnects automatically
// after PM2 brings the worker back up.
//
// Implementation note: we detached-spawn `pm2 restart steward-worker` so the
// signal travels through the PM2 daemon (not from this Express process tree).
// Without `detached: true` + `unref()`, the child would keep this process
// alive; with them, the spawn is fire-and-forget.
router.post('/restart-worker', (_req, res) => {
  res.json({
    ok: true,
    message: 'Worker restart requested. Drain up to 60s, then PM2 brings it back up.',
  })
  // Small delay so the HTTP response definitely flushes before PM2 starts
  // killing things — PM2 is fast and steward-main keeps running, but the
  // detached child can race with response serialization on busy systems.
  setTimeout(() => {
    try {
      const child = spawn('pm2', ['restart', 'steward-worker'], {
        detached: true,
        stdio: 'ignore',
      })
      // ENOENT (pm2 missing) and similar surface as async 'error' events,
      // not sync throws — without this listener Node treats them as unhandled.
      child.on('error', (err) => {
        console.error('[admin] pm2 restart steward-worker spawn failed:', err.message)
      })
      child.unref()
    } catch (err) {
      console.error('[admin] failed to spawn pm2 restart steward-worker:', err)
    }
  }, 200)
})

export default router
