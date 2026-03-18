import webpush from 'web-push'
import { pushSubscriptionQueries } from '../db/index.js'

export type PushPayload = {
  title: string
  body: string
  url?: string
}

/** Whether push is configured — reads env vars lazily so dotenv has already run. */
export function isPushEnabled(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

let vapidInitialised = false

function ensureVapid(): boolean {
  if (vapidInitialised) return true
  const pubKey = process.env.VAPID_PUBLIC_KEY
  const privKey = process.env.VAPID_PRIVATE_KEY
  if (!pubKey || !privKey) return false
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
    pubKey,
    privKey,
  )
  vapidInitialised = true
  return true
}

async function sendOne(
  sub: { endpoint: string; p256dh: string; auth: string },
  encoded: string,
  attempt = 1,
): Promise<void> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      encoded,
    )
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode
    const body = (err as { body?: string }).body ?? ''
    const isPermanent = status === 410 || status === 404 ||
      (status === 400 && body.includes('VapidPkHashMismatch'))
    if (isPermanent) {
      // Subscription is gone or permanently incompatible (e.g. VAPID key rotation) — remove it.
      console.warn('[push] removing stale subscription:', { endpoint: sub.endpoint.slice(-30), status, body })
      pushSubscriptionQueries.deleteByEndpoint(sub.endpoint)
    } else if (attempt < 2 && (!status || status >= 500)) {
      // Transient failure (5xx or network error) — retry once after a short delay.
      console.warn(`[push] transient error (attempt ${attempt}), retrying:`, status ?? err)
      await new Promise((r) => setTimeout(r, 1000))
      await sendOne(sub, encoded, attempt + 1)
    } else {
      console.error('[push] send failed', {
        endpoint: sub.endpoint.slice(-30),
        status,
        attempt,
        err,
      })
    }
  }
}

/**
 * Send a push notification to all registered subscriptions.
 * VAPID credentials are initialised once per process lifetime (lazy).
 * Stale subscriptions (410/404/VapidPkHashMismatch) are automatically removed.
 * Transient failures (5xx, network) are retried once.
 */
export async function notifyAll(payload: PushPayload): Promise<void> {
  if (!ensureVapid()) return

  const subs = pushSubscriptionQueries.list()
  if (subs.length === 0) return

  const encoded = JSON.stringify(payload)
  await Promise.allSettled(subs.map((sub) => sendOne(sub, encoded)))
}
