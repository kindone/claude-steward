import { Router } from 'express'
import { registerConnection } from '../lib/connections.js'

const router = Router()

// Long-lived SSE stream for app-level events (reload, future: scheduler notifications).
// The client connects on mount and holds this open for the browser session lifetime.
router.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  registerConnection(res)

  // Keep-alive ping every 30s to prevent proxy/browser timeouts
  const ping = setInterval(() => {
    if (res.writableEnded) { clearInterval(ping); return }
    res.write(':ping\n\n')
  }, 30_000)

  res.on('close', () => clearInterval(ping))
})

export default router
