/**
 * Internal MCP notification endpoint.
 *
 * POST /api/mcp-notify
 *
 * Called by the MCP schedule server subprocess after any schedule mutation.
 * Validates the shared X-MCP-Secret header, then broadcasts a `schedules_changed`
 * SSE event to all connected clients so the bell panel refreshes in real time.
 *
 * This route is mounted BEFORE requireAuth in app.ts — the MCP server subprocess
 * cannot hold a session cookie, so the shared secret is the auth mechanism.
 */

import { Router } from 'express'
import { broadcastEvent } from '../lib/connections.js'

const router = Router()

router.post('/', (req, res) => {
  const secret = process.env.MCP_NOTIFY_SECRET
  if (!secret || req.headers['x-mcp-secret'] !== secret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { sessionId } = req.body as { sessionId?: string }
  broadcastEvent('schedules_changed', { sessionId: sessionId ?? null })

  res.status(204).end()
})

export default router
