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

/** Compute the next UTC unix timestamp (seconds) for a cron expression. Returns null on parse error. */
export function nextFireAt(cronExpr: string): number | null {
  try {
    const interval = CronExpressionParser.parse(cronExpr, { tz: 'UTC' })
    return Math.floor(interval.next().getTime() / 1000)
  } catch {
    return null
  }
}

async function runSchedule(schedule: Schedule): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const nextRun = nextFireAt(schedule.cron)

  // Advance next_run_at immediately to prevent double-fire if the tick is slow
  scheduleQueries.markRan(schedule.id, now, nextRun)

  // Auto-disable if explicitly marked as once — fire once, then done.
  if (schedule.once) {
    scheduleQueries.update(schedule.id, { enabled: false })
    console.log(`[scheduler] auto-disabled one-shot schedule ${schedule.id}`)
  }

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
      title: session.title === 'New Chat' ? 'Claude replied' : session.title,
      body: preview.slice(0, 80) + (preview.length > 80 ? '…' : ''),
      url: `/?session=${schedule.session_id}`,
    }
    // Try session-targeted subs first; fall back to all global (untagged) subs
    const sessionSubs = pushSubscriptionQueries.listBySession(schedule.session_id)
    if (sessionSubs.length > 0) {
      void notifySession(schedule.session_id, payload)
    } else {
      void notifyAll(payload)
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
