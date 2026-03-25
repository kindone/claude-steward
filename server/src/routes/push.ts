import type { Request, Response } from 'express'
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { pushSubscriptionQueries } from '../db/index.js'
import { isPushEnabled } from '../lib/pushNotifications.js'

const router = Router()

/**
 * GET /api/push/vapid-public-key — public (no auth). The key is not secret.
 * Mounted in app.ts before requireAuth so the SW can fetch it anytime.
 */
export function vapidPublicKeyHandler(_req: Request, res: Response): void {
  const key = process.env.VAPID_PUBLIC_KEY
  if (!key) {
    res.status(503).json({ error: 'Push not configured' })
    return
  }
  res.json({ key })
}

/**
 * POST /api/push/subscribe
 * Body: { endpoint, keys: { p256dh, auth } }
 * Upserts the subscription (updates keys if endpoint already registered).
 */
router.post('/subscribe', (req, res) => {
  if (!isPushEnabled()) {
    res.status(503).json({ error: 'Push notifications not configured on this server' })
    return
  }

  const { endpoint, keys } = req.body as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: 'endpoint, keys.p256dh and keys.auth are required' })
    return
  }

  pushSubscriptionQueries.upsert(uuidv4(), endpoint, keys.p256dh, keys.auth)
  res.status(201).json({ ok: true })
})

/**
 * DELETE /api/push/subscribe
 * Body: { endpoint }
 * Removes the subscription for this browser/device.
 */
router.delete('/subscribe', (req, res) => {
  const { endpoint } = req.body as { endpoint?: string }
  if (!endpoint) {
    res.status(400).json({ error: 'endpoint is required' })
    return
  }
  pushSubscriptionQueries.deleteByEndpoint(endpoint)
  res.json({ ok: true })
})

export default router
