import { Router } from 'express'
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
// Intended to be called by Claude after a successful `npm run build`.
router.post('/reload', (_req, res) => {
  res.json({ ok: true, message: 'Reload broadcast sent. Server restarting…' })
  broadcastEvent('reload', { version: startedAt })
  setTimeout(() => process.exit(0), 200)
})

export default router
