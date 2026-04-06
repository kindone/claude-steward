// Feature:     Scheduler — fire-time condition evaluation
// Arch/Design: evaluateCondition is a pure function that takes a parsed ScheduleCondition
//              and a UTC Date, returning true if the schedule should fire.
//              The scheduler calls this after each cron tick to decide whether to
//              actually send the prompt (false = advance next_run_at, skip send).
// Spec:
//   every_n_days:
//     ∀ condition where n>=1, ref=YYYY-MM-DD:
//       → true  iff (today_utc - ref).days >= 0 AND divisible by n
//       → false when today < ref (before anchor)
//       → true  on day 0 (ref itself)
//   last_day_of_month:
//     → true  iff tomorrow UTC is the 1st of a new month
//     → false on any other day
//   nth_weekday:
//     → true  iff today's weekday matches AND ceil(date/7) === n
//     → false on wrong weekday
//     → false on correct weekday but wrong occurrence
//   unknown type: → always true (forward-compatibility, non-blocking)
// @quality:    correctness
// @type:       example
// @mode:       verification

import { describe, it, expect } from 'vitest'
import { evaluateCondition, type ScheduleCondition } from '../../lib/scheduler.js'

// ── every_n_days ──────────────────────────────────────────────────────────────

describe('evaluateCondition — every_n_days', () => {

  it('returns true on the anchor date itself (day 0 % n === 0)', () => {
    const cond: ScheduleCondition = { type: 'every_n_days', n: 10, ref: '2026-04-06' }
    expect(evaluateCondition(cond, new Date('2026-04-06T09:00:00Z'))).toBe(true)
  })

  it('returns true exactly n days after the anchor', () => {
    const cond: ScheduleCondition = { type: 'every_n_days', n: 10, ref: '2026-04-06' }
    expect(evaluateCondition(cond, new Date('2026-04-16T09:00:00Z'))).toBe(true)  // +10 days
    expect(evaluateCondition(cond, new Date('2026-04-26T09:00:00Z'))).toBe(true)  // +20 days
  })

  it('returns false on non-boundary days', () => {
    const cond: ScheduleCondition = { type: 'every_n_days', n: 10, ref: '2026-04-06' }
    expect(evaluateCondition(cond, new Date('2026-04-09T09:00:00Z'))).toBe(false)  // +3 days
    expect(evaluateCondition(cond, new Date('2026-04-15T09:00:00Z'))).toBe(false)  // +9 days
    expect(evaluateCondition(cond, new Date('2026-04-17T09:00:00Z'))).toBe(false)  // +11 days
  })

  it('returns false before the anchor date', () => {
    const cond: ScheduleCondition = { type: 'every_n_days', n: 10, ref: '2026-04-06' }
    expect(evaluateCondition(cond, new Date('2026-03-30T09:00:00Z'))).toBe(false)
    expect(evaluateCondition(cond, new Date('2026-04-05T09:00:00Z'))).toBe(false)
  })

  it('biweekly (n=14): fires every two weeks from anchor', () => {
    const cond: ScheduleCondition = { type: 'every_n_days', n: 14, ref: '2026-04-06' }
    expect(evaluateCondition(cond, new Date('2026-04-06T00:00:00Z'))).toBe(true)   // week 0
    expect(evaluateCondition(cond, new Date('2026-04-20T00:00:00Z'))).toBe(true)   // week 2
    expect(evaluateCondition(cond, new Date('2026-05-04T00:00:00Z'))).toBe(true)   // week 4
    expect(evaluateCondition(cond, new Date('2026-04-13T00:00:00Z'))).toBe(false)  // week 1 — skip
    expect(evaluateCondition(cond, new Date('2026-04-27T00:00:00Z'))).toBe(false)  // week 3 — skip
  })

  it('n=1 fires every day', () => {
    const cond: ScheduleCondition = { type: 'every_n_days', n: 1, ref: '2026-01-01' }
    for (const date of ['2026-01-01', '2026-01-02', '2026-03-15', '2026-12-31']) {
      expect(evaluateCondition(cond, new Date(date + 'T12:00:00Z'))).toBe(true)
    }
  })

})

// ── last_day_of_month ─────────────────────────────────────────────────────────

describe('evaluateCondition — last_day_of_month', () => {

  const cond: ScheduleCondition = { type: 'last_day_of_month' }

  it('returns true on the last day of months with 31 days', () => {
    expect(evaluateCondition(cond, new Date('2026-01-31T12:00:00Z'))).toBe(true)
    expect(evaluateCondition(cond, new Date('2026-03-31T12:00:00Z'))).toBe(true)
    expect(evaluateCondition(cond, new Date('2026-12-31T12:00:00Z'))).toBe(true)
  })

  it('returns true on the last day of months with 30 days', () => {
    expect(evaluateCondition(cond, new Date('2026-04-30T12:00:00Z'))).toBe(true)
    expect(evaluateCondition(cond, new Date('2026-06-30T12:00:00Z'))).toBe(true)
    expect(evaluateCondition(cond, new Date('2026-09-30T12:00:00Z'))).toBe(true)
  })

  it('returns true on Feb 28 in a non-leap year', () => {
    expect(evaluateCondition(cond, new Date('2026-02-28T12:00:00Z'))).toBe(true)
  })

  it('returns true on Feb 29 in a leap year', () => {
    expect(evaluateCondition(cond, new Date('2024-02-29T12:00:00Z'))).toBe(true)
  })

  it('returns false on Feb 28 in a leap year (not the last day)', () => {
    expect(evaluateCondition(cond, new Date('2024-02-28T12:00:00Z'))).toBe(false)
  })

  it('returns false on mid-month days', () => {
    expect(evaluateCondition(cond, new Date('2026-04-15T12:00:00Z'))).toBe(false)
    expect(evaluateCondition(cond, new Date('2026-01-01T12:00:00Z'))).toBe(false)
    expect(evaluateCondition(cond, new Date('2026-03-30T12:00:00Z'))).toBe(false)
  })

})

// ── nth_weekday ───────────────────────────────────────────────────────────────

describe('evaluateCondition — nth_weekday', () => {

  // April 2026 calendar:
  //   Wed Apr  1 (weekday=3)
  //   Tue Apr  7 (weekday=2) — 1st Tuesday
  //   Tue Apr 14 (weekday=2) — 2nd Tuesday
  //   Tue Apr 21 (weekday=2) — 3rd Tuesday
  //   Mon Apr  6 (weekday=1) — 1st Monday
  //   Mon Apr 13 (weekday=1) — 2nd Monday

  it('returns true for 1st Tuesday of April 2026', () => {
    const cond: ScheduleCondition = { type: 'nth_weekday', n: 1, weekday: 2 }
    expect(evaluateCondition(cond, new Date('2026-04-07T09:00:00Z'))).toBe(true)
  })

  it('returns true for 2nd Tuesday of April 2026', () => {
    const cond: ScheduleCondition = { type: 'nth_weekday', n: 2, weekday: 2 }
    expect(evaluateCondition(cond, new Date('2026-04-14T09:00:00Z'))).toBe(true)
  })

  it('returns false for 1st Tuesday when it is actually the 2nd Tuesday', () => {
    const cond: ScheduleCondition = { type: 'nth_weekday', n: 1, weekday: 2 }
    expect(evaluateCondition(cond, new Date('2026-04-14T09:00:00Z'))).toBe(false)
  })

  it('returns false for correct n but wrong weekday', () => {
    const cond: ScheduleCondition = { type: 'nth_weekday', n: 1, weekday: 1 }  // 1st Monday
    expect(evaluateCondition(cond, new Date('2026-04-07T09:00:00Z'))).toBe(false)  // is Tuesday
  })

  it('returns true for 1st Monday of April 2026', () => {
    const cond: ScheduleCondition = { type: 'nth_weekday', n: 1, weekday: 1 }
    expect(evaluateCondition(cond, new Date('2026-04-06T09:00:00Z'))).toBe(true)
  })

  it('returns false for a day that happens to be the right weekday but wrong n', () => {
    const cond: ScheduleCondition = { type: 'nth_weekday', n: 3, weekday: 2 }
    expect(evaluateCondition(cond, new Date('2026-04-07T09:00:00Z'))).toBe(false)  // 1st Tue, not 3rd
    expect(evaluateCondition(cond, new Date('2026-04-21T09:00:00Z'))).toBe(true)   // 3rd Tue ✓
  })

})

// ── unknown condition type ────────────────────────────────────────────────────

describe('evaluateCondition — unknown type', () => {

  it('returns true for unknown condition types (forward-compatible, non-blocking)', () => {
    // @ts-expect-error — testing unknown type at runtime
    const cond = { type: 'some_future_type', n: 42 } as ScheduleCondition
    expect(evaluateCondition(cond, new Date())).toBe(true)
  })

})
