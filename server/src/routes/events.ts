import { Router } from 'express'
import { registerConnection, setConnectionVisibility } from '../lib/connections.js'

const router = Router()

// Long-lived SSE stream for app-level events (reload, future: scheduler notifications).
// The client connects on mount and holds this open for the browser session lifetime.
router.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const connectionId = registerConnection(res)

  // Send connection ID so the client can POST visibility changes
  res.write(`event: connected\ndata: ${JSON.stringify({ connectionId })}\n\n`)

  // Keep-alive ping every 30s to prevent proxy/browser timeouts
  const ping = setInterval(() => {
    if (res.writableEnded) { clearInterval(ping); return }
    res.write(':ping\n\n')
  }, 30_000)

  res.on('close', () => clearInterval(ping))
})

// POST /api/events/visibility — client reports page visibility changes.
// Body: { connectionId: string, visible: boolean }
router.post('/visibility', (req, res) => {
  const { connectionId, visible } = req.body as { connectionId?: string; visible?: boolean }
  if (!connectionId || typeof visible !== 'boolean') {
    res.status(400).json({ error: 'connectionId and visible are required' })
    return
  }
  setConnectionVisibility(connectionId, visible)
  res.json({ ok: true })
})

export default router
