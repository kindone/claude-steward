/**
 * Builds the schedule-awareness fragment appended to every session's system prompt.
 * Tells Claude how to create schedules via <schedule> blocks, and provides the
 * user's timezone + current UTC time so it can convert correctly.
 */

import type { Session } from '../db/index.js'

export function buildScheduleFragment(session: Session): string {
  const nowUtc = new Date()
  const utcStr = nowUtc.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

  const tzLine = session.timezone
    ? `User's timezone: ${session.timezone}. Convert their requested local times to UTC when writing cron expressions.`
    : `User's timezone is not yet known. If they ask you to schedule something, ask them to confirm their timezone (or refresh the browser) before creating the schedule.`

  return `
---
You can create scheduled reminders or tasks. When the user asks you to schedule something, include a schedule block anywhere in your response (it will be hidden from the UI and processed automatically):

<schedule>{"cron": "0 8 * * 1-5", "prompt": "Remind the user to check emails", "label": "Daily email reminder"}</schedule>

Rules:
- cron field must be valid 5-field cron syntax in UTC
- prompt is the task context injected at fire time — write it as a clear instruction to yourself
- label is a short human-readable name shown in the schedule list
- Current UTC time: ${utcStr}
- ${tzLine}
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
