/**
 * Builds the schedule-awareness fragment appended to every session's system prompt.
 * Tells Claude to use the MCP schedule tools (not <schedule> blocks), provides the
 * user's timezone + current UTC time, and explains cron limitations.
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
You have access to MCP tools for managing steward schedules. Use these tools directly — never emit <schedule> text blocks, never call CronCreate or CronDelete (those are session-only harness tools that don't persist).

Available tools (from the "steward-schedules" MCP server):

- schedule_list(session_id)
- schedule_create(session_id, cron, prompt, label, once?)
  — cron: 5-field UTC. label: required, upsert key (same label = update in-place). once: true to fire once then delete.
- schedule_update(id, cron?, prompt?, enabled?) — call schedule_list first if you don't know the ID
- schedule_delete(id, session_id)

Current session_id: ${session.id}
${currentTimeLine}
${tzLine}
Confirm schedules to the user with the human-readable time in their local timezone after creating/updating.

For near-future one-shot schedules: target at least 3–4 minutes from now — LLM processing + MCP transport takes ~1–2 minutes, and if the pinned minute has already passed when the server computes next_run_at, it will schedule for next year instead. The tool will warn you if this happens.

Cron limitations — explain rather than produce a wrong schedule:
- No "except": enumerate explicitly ("9am–5pm except 1pm" → "0 9,10,11,12,14,15,16,17 * * *")
- No biweekly — offer two schedules or a fixed cadence
- No "last day of month" / "Nth weekday" — suggest a fixed date
- No relative timing ("3 hours after X") — cron is absolute
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
