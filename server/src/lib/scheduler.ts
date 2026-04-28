/**
 * Scheduled conversation runner.
 * Ticks every minute, fires due schedules, sends a headless message to the session,
 * then notifies watchers/subscribers and fires a targeted push notification.
 */

import cron from 'node-cron'
import { CronExpressionParser } from 'cron-parser'
import { scheduleQueries, sessionQueries, type Schedule } from '../db/index.js'
import { sendToSession } from './sendToSession.js'
import { notifyWatchers, notifySubscribers } from './sessionWatchers.js'
import { notifySession, notifyAll } from './pushNotifications.js'
import { pushSubscriptionQueries } from '../db/index.js'
import { setLastPushTarget } from './pushNotifications.js'
import { broadcastEvent, hasActiveClients } from './connections.js'

/**
 * Compute the next UTC unix timestamp (seconds) for a cron expression.
 * Returns null if the expression is invalid or unparseable.
 * Uses node-cron to validate first (strict), then cron-parser to compute the
 * next fire time — cron-parser alone is too lenient (accepts empty strings,
 * out-of-range values, etc.) and would silently produce nonsensical schedules.
 */
export function nextFireAt(cronExpr: string): number | null {
  if (!cronExpr || !cron.validate(cronExpr)) return null
  try {
    const interval = CronExpressionParser.parse(cronExpr, { tz: 'UTC' })
    return Math.floor(interval.next().getTime() / 1000)
  } catch {
    return null
  }
}

/**
 * Count how many times a cron expression fires between firstFire and expiresAt (inclusive).
 * Caps at maxCheck to avoid iterating dense schedules indefinitely.
 */
export function countFiresBeforeExpiry(cronExpr: string, firstFire: number, expiresAt: number, maxCheck = 3): number {
  if (firstFire > expiresAt) return 0
  let count = 0
  try {
    const interval = CronExpressionParser.parse(cronExpr, {
      tz: 'UTC',
      currentDate: new Date((firstFire - 1) * 1000),
    })
    while (count < maxCheck) {
      const ts = Math.floor(interval.next().getTime() / 1000)
      if (ts > expiresAt) break
      count++
    }
  } catch { /* ignore */ }
  return count
}

// ── Condition types ───────────────────────────────────────────────────────────

export type ScheduleCondition =
  | { type: 'every_n_days'; n: number; ref: string }  // ref = YYYY-MM-DD UTC date anchor
  | { type: 'last_day_of_month' }
  | { type: 'nth_weekday'; n: number; weekday: number }  // weekday: 0=Sun … 6=Sat

/**
 * Evaluate whether a fire-time condition is met for the given UTC datetime.
 * Returns true if the condition passes (schedule should fire).
 * Unknown condition types default to true (non-blocking forward compatibility).
 */
export function evaluateCondition(condition: ScheduleCondition, now: Date): boolean {
  switch (condition.type) {
    case 'every_n_days': {
      const ref = new Date(condition.ref + 'T00:00:00Z')
      const daysDiff = Math.floor((now.getTime() - ref.getTime()) / 86_400_000)
      return daysDiff >= 0 && daysDiff % condition.n === 0
    }
    case 'last_day_of_month': {
      const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
      return tomorrow.getUTCDate() === 1
    }
    case 'nth_weekday': {
      if (now.getUTCDay() !== condition.weekday) return false
      return Math.ceil(now.getUTCDate() / 7) === condition.n
    }
    default:
      return true
  }
}

async function runSchedule(schedule: Schedule): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const nowDate = new Date()
  const nextRun = nextFireAt(schedule.cron)

  // Evaluate condition — if false, advance next_run_at but skip firing.
  // This keeps the schedule alive for the next cron tick without double-firing.
  if (schedule.condition) {
    let condition: ScheduleCondition | null = null
    try {
      condition = JSON.parse(schedule.condition) as ScheduleCondition
    } catch {
      console.warn(`[scheduler] schedule ${schedule.id} has malformed condition JSON — firing anyway`)
    }
    if (condition && !evaluateCondition(condition, nowDate)) {
      scheduleQueries.markRan(schedule.id, now, nextRun)
      broadcastEvent('schedules_changed', { sessionId: schedule.session_id })
      return
    }
  }

  // Advance next_run_at immediately to prevent double-fire if the tick is slow
  scheduleQueries.markRan(schedule.id, now, nextRun)

  // Auto-delete if explicitly marked as once — fire once, then gone.
  if (schedule.once) {
    scheduleQueries.delete(schedule.id)
    console.log(`[scheduler] deleted one-shot schedule ${schedule.id}`)
  } else if (schedule.expires_at !== null && nextRun !== null && nextRun > schedule.expires_at) {
    // This was the last fire before expiry — clean up so it doesn't linger
    scheduleQueries.delete(schedule.id)
    console.log(`[scheduler] schedule ${schedule.id} expired after this fire — deleted`)
  }

  // Notify the client that the schedule list changed (fired/deleted)
  broadcastEvent('schedules_changed', { sessionId: schedule.session_id })

  const session = sessionQueries.findById(schedule.session_id)
  if (!session) {
    console.warn(`[scheduler] session ${schedule.session_id} not found for schedule ${schedule.id} — skipping`)
    return
  }

  let result: { content: string; errorCode?: string }
  try {
    result = await sendToSession(schedule.session_id, schedule.prompt, { source: 'scheduler' })
  } catch (err) {
    console.error(`[scheduler] schedule ${schedule.id} send failed:`, err)
    return
  }

  if (result.errorCode) {
    console.warn(`[scheduler] schedule ${schedule.id} completed with error: ${result.errorCode}`)
  }

  const notified = notifyWatchers(schedule.session_id)
  notifySubscribers(schedule.session_id)

  // Only push if no watcher tab already has the session open
  if (notified === 0 && result.content) {
    const preview = result.content.replace(/\s+/g, ' ').trim()
    const payload = {
      title: session.title === 'New Chat' ? 'New reply' : session.title,
      body: preview.slice(0, 80) + (preview.length > 80 ? '…' : ''),
      url: `/?session=${schedule.session_id}${session.project_id ? `&project=${session.project_id}` : ''}`,
    }
    const pushTarget = { sessionId: schedule.session_id, projectId: session.project_id ?? null, title: session.title ?? 'New message', body: payload.body }
    if (hasActiveClients()) {
      // User is in the app — show in-app toast, skip push
      broadcastEvent('pushTarget', pushTarget)
    } else {
      // User left the app — send push notification + store target for visibilitychange poll
      const sessionSubs = pushSubscriptionQueries.listBySession(schedule.session_id)
      if (sessionSubs.length > 0) {
        void notifySession(schedule.session_id, payload)
      } else {
        void notifyAll(payload)
      }
      setLastPushTarget(pushTarget.sessionId, pushTarget.projectId)
    }
  }
}

export function startScheduler(): void {
  cron.schedule('* * * * *', () => {
    const now = Math.floor(Date.now() / 1000)
    const due = scheduleQueries.listDue(now)
    for (const schedule of due) {
      runSchedule(schedule).catch((err) =>
        console.error(`[scheduler] unhandled error for schedule ${schedule.id}:`, err)
      )
    }
  })
  console.log('[scheduler] started')
}
