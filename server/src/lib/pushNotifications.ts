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

/**
 * Send a push notification to all registered subscriptions.
 * Reads VAPID credentials at call time (not module init) to avoid ESM hoisting issues.
 * Stale subscriptions (410/404 from the push service) are automatically removed.
 */
export async function notifyAll(payload: PushPayload): Promise<void> {
  const pubKey = process.env.VAPID_PUBLIC_KEY
  const privKey = process.env.VAPID_PRIVATE_KEY
  if (!pubKey || !privKey) return

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
    pubKey,
    privKey,
  )

  const subs = pushSubscriptionQueries.list()
  if (subs.length === 0) return

  const encoded = JSON.stringify(payload)

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          encoded,
        )
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 410 || status === 404) {
          pushSubscriptionQueries.deleteByEndpoint(sub.endpoint)
        } else {
          console.error('[push] send error:', err)
        }
      }
    }),
  )
}
