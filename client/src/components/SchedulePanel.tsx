import { useState, useEffect } from 'react'
import cronstrue from 'cronstrue'
import { listSchedules, updateSchedule, deleteSchedule, runScheduleNow, type Schedule } from '../lib/api'

type Props = {
  sessionId: string
  timezone?: string | null
  refreshTick?: number
}

// ── Display helpers ───────────────────────────────────────────────────────────

/**
 * Get the current UTC offset of a timezone in minutes.
 * e.g. Asia/Seoul → +540, America/New_York → -300 (EST)
 */
function getTimezoneOffsetMinutes(timezone: string): number {
  try {
    const now = new Date()
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)
    const lh = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0') % 24
    const lm = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0')
    let diff = (lh * 60 + lm) - (now.getUTCHours() * 60 + now.getUTCMinutes())
    if (diff > 720) diff -= 1440
    if (diff < -720) diff += 1440
    return diff
  } catch {
    return 0
  }
}

/**
 * Shift a cron's minute+hour fields from UTC to local time.
 * Only works when minute and hour are plain numbers (not wildcards/ranges/steps).
 * Returns null if the cron can't be safely adjusted (caller should fall back to UTC label).
 */
function cronToLocalTime(cronExpr: string, offsetMinutes: number): string | null {
  if (offsetMinutes === 0) return cronExpr
  const parts = cronExpr.split(' ')
  if (parts.length !== 5) return null
  const [minField, hourField, ...rest] = parts
  // Only handle simple numeric fields — wildcards/steps are already timezone-agnostic
  if (!/^\d+$/.test(minField) || !/^\d+(,\d+)*$/.test(hourField)) return null
  const utcMin = parseInt(minField)
  const utcHours = hourField.split(',').map(Number)
  // Shift each UTC hour+minute by the timezone offset
  const localTimes = utcHours.map(h => {
    const total = ((h * 60 + utcMin + offsetMinutes) % 1440 + 1440) % 1440
    return { h: Math.floor(total / 60), m: total % 60 }
  })
  const localMin = localTimes[0].m  // minute is the same for all hours after a pure hour-shift
  const localHours = localTimes.map(t => t.h).sort((a, b) => a - b)
  return [String(localMin), localHours.join(','), ...rest].join(' ')
}

/**
 * Convert a cron expression to a human-readable string in the user's local time.
 * - If timezone is known and cron uses specific hours: shifts to local time, no suffix.
 * - If cron is relative (every N min, every hour): timezone-agnostic, no suffix.
 * - If timezone unknown or adjustment fails: shows UTC with "(UTC)" suffix.
 */
function describeCron(cronExpr: string, timezone?: string | null): string {
  try {
    const parts = cronExpr.split(' ')
    const hourField = parts[1] ?? '*'
    // Relative/agnostic patterns (wildcards, steps) — describe as-is, no UTC label needed
    const isAgnostic = hourField === '*' || hourField.startsWith('*/')
    if (isAgnostic) {
      return cronstrue.toString(cronExpr, { use24HourTimeFormat: true })
    }
    // Time-specific: try to shift to local
    if (timezone) {
      const offsetMins = getTimezoneOffsetMinutes(timezone)
      const localCron = cronToLocalTime(cronExpr, offsetMins)
      if (localCron) {
        return cronstrue.toString(localCron, { use24HourTimeFormat: true })
      }
    }
    // Fallback: show UTC with label
    return cronstrue.toString(cronExpr, { use24HourTimeFormat: true }) + ' (UTC)'
  } catch {
    return cronExpr
  }
}

type ConditionShape =
  | { type: 'every_n_days'; n: number; ref: string }
  | { type: 'last_day_of_month' }
  | { type: 'nth_weekday'; n: number; weekday: number }

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th']

/** Plain-English description of a condition JSON string, or null if not present. */
function describeCondition(conditionJson: string | null): string | null {
  if (!conditionJson) return null
  try {
    const c = JSON.parse(conditionJson) as ConditionShape
    switch (c.type) {
      case 'every_n_days':
        if (c.n === 14) return `Every other week (from ${c.ref})`
        if (c.n === 7)  return `Every week (from ${c.ref})`
        return `Every ${c.n} days (from ${c.ref})`
      case 'last_day_of_month':
        return 'Last day of each month'
      case 'nth_weekday':
        return `${ORDINALS[c.n] ?? `${c.n}th`} ${WEEKDAY_NAMES[c.weekday] ?? '?'} of each month`
      default:
        return null
    }
  } catch {
    return null
  }
}

/** "Until Apr 6 at 5:00 PM KST" in the session's local timezone, or null. */
function describeExpiry(expiresAt: number | null, timezone?: string | null): string | null {
  if (!expiresAt) return null
  const date = new Date(expiresAt * 1000)
  try {
    const str = date.toLocaleString('en-US', {
      timeZone: timezone ?? undefined,
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZoneName: 'short',
    })
    return `Until ${str}`
  } catch {
    return `Until ${date.toLocaleString()}`
  }
}

/** Format next/last run timestamps in local timezone with abbreviation. */
function formatTime(unixSec: number | null, timezone?: string | null): string {
  if (!unixSec) return '—'
  const date = new Date(unixSec * 1000)
  try {
    return date.toLocaleString('en-US', {
      timeZone: timezone ?? undefined,
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return date.toLocaleString()
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SchedulePanel({ sessionId, timezone, refreshTick }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    listSchedules(sessionId)
      .then(setSchedules)
      .catch(() => setSchedules([]))
      .finally(() => setLoading(false))
  }, [sessionId, refreshTick])

  async function handleToggle(s: Schedule) {
    try {
      const updated = await updateSchedule(s.id, { enabled: s.enabled === 0 })
      setSchedules((prev) => prev.map((x) => (x.id === s.id ? updated : x)))
    } catch (err) {
      console.error('[schedule] toggle failed:', err)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteSchedule(id)
      setSchedules((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      console.error('[schedule] delete failed:', err)
    }
  }

  async function handleRunNow(id: string) {
    try {
      await runScheduleNow(id)
    } catch (err) {
      console.error('[schedule] run failed:', err)
    }
  }

  return (
    <div className="px-3 pb-3 flex flex-col gap-2">
      {loading ? (
        <p className="text-[11px] text-app-text-6">Loading…</p>
      ) : schedules.length === 0 ? (
        <p className="text-[11px] text-app-text-7 italic">
          No schedules yet — ask Claude to schedule something for you.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {schedules.map((s) => {
            const title = s.label || s.prompt.slice(0, 60)
            const cronDesc = describeCron(s.cron, timezone)
            const conditionDesc = describeCondition(s.condition)
            const expiryDesc = describeExpiry(s.expires_at, timezone)

            return (
              <li
                key={s.id}
                className={`border rounded-md px-2.5 py-2 flex flex-col gap-1 transition-colors ${s.enabled ? 'border-app-border-2' : 'border-app-bg-overlay opacity-60'}`}
              >
                {/* Row 1: toggle + title + badges + actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggle(s)}
                    title={s.enabled ? 'Disable' : 'Enable'}
                    className={`w-8 h-4 rounded-full flex-shrink-0 transition-colors relative ${s.enabled ? 'bg-blue-600' : 'bg-app-border-3'}`}
                  >
                    <span className={`absolute top-0.5 left-0 w-3 h-3 rounded-full bg-white transition-transform ${s.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                  </button>

                  <span
                    className="flex-1 text-[12px] font-medium text-app-text-2 truncate"
                    title={s.label ? s.prompt : undefined}
                  >
                    {title}
                  </span>

                  {s.once === 1 && (
                    <span className="text-[10px] text-app-text-6 border border-app-border-2 rounded px-1 py-px flex-shrink-0">once</span>
                  )}

                  <button
                    onClick={() => handleRunNow(s.id)}
                    title="Run now"
                    className="text-[11px] text-app-text-6 hover:text-app-text-3 flex-shrink-0 px-1"
                  >
                    ▶
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    title="Delete"
                    className="text-[11px] text-app-text-6 hover:text-red-500 flex-shrink-0 px-1"
                  >
                    ×
                  </button>
                </div>

                {/* Row 2: human-readable cron + condition + expiry */}
                <div className="pl-10 flex flex-col gap-0.5">
                  <p
                    className="text-[10px] text-app-text-6"
                    title={s.cron}
                  >
                    {cronDesc}
                    {conditionDesc && (
                      <span className="ml-1 text-app-text-7">· {conditionDesc}</span>
                    )}
                  </p>
                  {expiryDesc && (
                    <p className="text-[10px] text-amber-700">{expiryDesc}</p>
                  )}
                </div>

                {/* Row 3: next / last run */}
                <div className="text-[10px] text-app-text-7 pl-10">
                  Next: {formatTime(s.next_run_at, timezone)}
                  {s.last_run_at != null && (
                    <span className="ml-2">· Last: {formatTime(s.last_run_at, timezone)}</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
