/**
 * Builds the schedule-awareness fragment appended to every session's system prompt.
 * Tells Claude how to create schedules via <schedule> blocks, and provides the
 * user's timezone + current UTC time so it can convert correctly.
 */

import type { Session } from '../db/index.js'

export function buildScheduleFragment(session: Session): string {
  const nowUtc = new Date()
  const utcStr = nowUtc.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

  let currentTimeLine: string
  let tzLine: string
  if (session.timezone) {
    let localStr: string
    try {
      localStr = nowUtc.toLocaleString('en-US', {
        timeZone: session.timezone,
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
    } catch {
      // Invalid IANA timezone stored — fall back to UTC display
      localStr = utcStr
    }
    currentTimeLine = `Current time: ${localStr} (${session.timezone}) / ${utcStr}`
    tzLine = `When confirming schedules to the user, always show times in their local timezone (${session.timezone}), not UTC. Convert requested local times to UTC when writing cron expressions.`
  } else {
    currentTimeLine = `Current UTC time: ${utcStr}`
    tzLine = `User's timezone is not yet known. If they ask you to schedule something, ask them to confirm their timezone (or refresh the browser) before creating the schedule.`
  }

  return `
---
You can create scheduled reminders or tasks. When the user asks you to schedule something, include a schedule block anywhere in your response (it will be hidden from the UI and processed automatically):

<schedule>{"cron": "0 8 * * 1-5", "prompt": "Remind the user to check emails", "label": "Daily email reminder"}</schedule>

Rules:
- cron field must be valid 5-field cron syntax in UTC
- prompt is the task context injected at fire time — write it as a clear instruction to yourself
- label is a short human-readable name shown in the schedule list
- once: true means the schedule fires exactly once then disables itself — use this for specific one-time reminders (e.g. "remind me on June 15th"). Omit or set false for recurring schedules.
- update: true means only update an existing schedule with this label — if no matching label exists the operation is rejected and the user is warned. Use this when the user explicitly asks to update/change an existing schedule. Omit (or set false) when creating a new schedule.
- Relative time baseline: treat "later", "from now", "in X minutes/hours" as relative to the current time unless the user explicitly states a different reference point (e.g. "30 minutes after that" or "an hour since the last reminder"). When in doubt, assume now.
- ${currentTimeLine}
- ${tzLine}

Cron limitations — handle these gracefully by explaining to the user rather than producing a wrong schedule:
- No native "except" support: enumerate allowed hours/days explicitly (e.g. "every hour 9am–5pm except 1pm" → "0 9,10,11,12,14,15,16,17 * * *")
- No biweekly/fortnightly ("every other week") — not expressible in 5-field cron; offer two separate schedules or ask the user to pick a fixed cadence
- No "last day of month" or "Nth weekday of month" (e.g. "second Tuesday") — not supported; suggest a fixed date instead
- No relative timing ("3 hours after the previous task") — cron is absolute, not relative
---`
}

/**
 * Returns the effective system prompt to pass to Claude:
 * the session's own system prompt (if any) plus the schedule awareness fragment.
 */
export function buildEffectiveSystemPrompt(session: Session): string | null {
  const fragment = buildScheduleFragment(session)
  if (session.system_prompt) {
    return session.system_prompt + '\n' + fragment
  }
  return fragment
}
