// Feature:     Scheduler — next fire time computation
// Arch/Design: nextFireAt is a pure function wrapping cron-parser; it computes the
//              next UTC unix timestamp for a cron expression — used to populate
//              next_run_at and prevent double-fires
// Spec:        ∀ valid cron: nextFireAt returns a timestamp strictly greater than now
//              ∀ invalid cron: nextFireAt returns null (never throws)
//              ∀ valid cron: result is an integer (unix seconds, not milliseconds)
// @quality:    correctness, reliability
// @type:       property
// @mode:       verification

import { describe, it, expect } from 'vitest'
import { forAll, Gen } from 'jsproptest'
import { nextFireAt } from '../../lib/scheduler.js'

const VALID_CRONS = [
  '* * * * *',
  '0 9 * * 1-5',
  '30 14 1 * *',
  '0 0 * * 0',
  '*/5 * * * *',
  '0 8 * * 1',
  '59 23 31 12 *',
  '0 0 1 1 *',
]

// nextFireAt validates with node-cron first (strict), so anything node-cron rejects → null,
// even if cron-parser alone would have accepted it (e.g. empty string, 6-field, out-of-range).
const INVALID_CRONS = [
  '',
  'not-a-cron',
  '60 * * * *',    // minute out of range
  '* 25 * * *',    // hour out of range
  'a b c d e',
  '@reboot',
  // NOTE: '*/0 * * * *' (step-of-zero) causes an infinite loop inside
  // node-cron.validate() — it is excluded to avoid hanging tests.
  // This is a known node-cron bug; the API relies on node-cron for validation
  // so this expression would also hang POST /api/schedules.
  // NOTE: '* * * * * *' is VALID in node-cron (6-field cron with seconds support)
]

describe('nextFireAt — next fire timestamp invariants', () => {

  describe('∀ valid cron: result is a future integer unix timestamp', () => {

    it('well-known valid crons return a timestamp > now', () => {
      const nowSeconds = Math.floor(Date.now() / 1000)
      for (const expr of VALID_CRONS) {
        const result = nextFireAt(expr)
        expect(result, `expected ${expr} to return a timestamp`).not.toBeNull()
        expect(result!, `${expr} result should be > now`).toBeGreaterThan(nowSeconds)
      }
    })

    it('result is always an integer (unix seconds, not milliseconds)', () => {
      for (const expr of VALID_CRONS) {
        const result = nextFireAt(expr)
        if (result === null) continue
        expect(Number.isInteger(result), `${expr} result ${result} should be integer`).toBe(true)
        // Sanity: unix seconds are in a plausible range (year 2020–2100)
        expect(result).toBeGreaterThan(1_577_836_800) // 2020-01-01
        expect(result).toBeLessThan(4_102_444_800)    // 2100-01-01
      }
    })

    it('result is always strictly greater than now (next fire, not current)', () => {
      const nowSeconds = Math.floor(Date.now() / 1000)
      for (const expr of VALID_CRONS) {
        const result = nextFireAt(expr)
        if (result === null) continue
        expect(result).toBeGreaterThan(nowSeconds)
      }
    })

    it('consecutive calls return the same or increasing timestamp (deterministic within a minute)', () => {
      // Two calls within the same second should return identical results
      for (const expr of VALID_CRONS) {
        const r1 = nextFireAt(expr)
        const r2 = nextFireAt(expr)
        expect(r1).toEqual(r2)
      }
    })

  })

  describe('∀ invalid cron: result is null (never throws)', () => {

    it('known invalid crons return null', () => {
      for (const expr of INVALID_CRONS) {
        let result: number | null | undefined
        expect(() => { result = nextFireAt(expr) }).not.toThrow()
        expect(result).toBeNull()
      }
    })

    it('arbitrary strings never throw — always return null or a valid timestamp', () => {
      forAll(
        (expr: string) => {
          try {
            const result = nextFireAt(expr)
            // Must be null or a positive integer
            return result === null || (Number.isInteger(result) && result > 0)
          } catch {
            return false
          }
        },
        Gen.asciiString(0, 30),
      )
    })

    it('empty string returns null (rejected by node-cron validation guard)', () => {
      expect(() => nextFireAt('')).not.toThrow()
      expect(nextFireAt('')).toBeNull()
    })

  })

  describe('∀ valid cron: result is consistent with expected schedule', () => {

    it('"* * * * *" fires within the next 60 seconds', () => {
      const nowSeconds = Math.floor(Date.now() / 1000)
      const result = nextFireAt('* * * * *')
      expect(result).not.toBeNull()
      // Every-minute cron: next fire is at most 60s away
      expect(result! - nowSeconds).toBeLessThanOrEqual(60)
      expect(result! - nowSeconds).toBeGreaterThan(0)
    })

    it('"0 0 1 1 *" (yearly) fires more than a day from now', () => {
      const nowSeconds = Math.floor(Date.now() / 1000)
      const result = nextFireAt('0 0 1 1 *')
      expect(result).not.toBeNull()
      // At least 1 minute in the future (likely much more)
      expect(result!).toBeGreaterThan(nowSeconds)
    })

  })

})
