// Feature:     Per-tab session persistence (refresh remembers this tab's session)
// Arch/Design: sessionStorage (per-tab) primary, localStorage (cross-tab) fallback.
//              See client/src/lib/sessionPersistence.ts for the rationale.
// Spec:        ∀ refresh: read returns sessionStorage value if set
//              ∀ new-tab: read returns localStorage fallback when sessionStorage empty
//              ∀ save:    writes to both stores
//              ∀ corrupt/partial JSON: read returns EMPTY, no throw
//              ∀ one-store failure: other store still written
// @quality:    correctness
// @type:       example
// @mode:       verification

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readLastState, saveLastState, LAST_STATE_KEY } from '../lib/sessionPersistence'

describe('sessionPersistence', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  describe('readLastState', () => {
    it('returns nulls when nothing is stored', () => {
      expect(readLastState()).toEqual({ projectId: null, sessionId: null })
    })

    it('prefers sessionStorage over localStorage (the per-tab refresh case)', () => {
      sessionStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'tab-P', sessionId: 'tab-S' }))
      localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'other-P', sessionId: 'other-S' }))
      expect(readLastState()).toEqual({ projectId: 'tab-P', sessionId: 'tab-S' })
    })

    it('falls back to localStorage when sessionStorage is empty (new-tab case)', () => {
      localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'fallback-P', sessionId: 'fallback-S' }))
      expect(readLastState()).toEqual({ projectId: 'fallback-P', sessionId: 'fallback-S' })
    })

    it('returns EMPTY when sessionStorage has invalid JSON (does not throw)', () => {
      sessionStorage.setItem(LAST_STATE_KEY, '{not valid json')
      expect(readLastState()).toEqual({ projectId: null, sessionId: null })
    })

    it('falls through from invalid sessionStorage to valid localStorage', () => {
      sessionStorage.setItem(LAST_STATE_KEY, '{not valid json')
      localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'good-P', sessionId: 'good-S' }))
      // sessionStorage's JSON.parse throws → caught → continue to localStorage
      expect(readLastState()).toEqual({ projectId: 'good-P', sessionId: 'good-S' })
    })

    it('rejects stored values that are not shaped like LastState', () => {
      // Someone wrote a bare string to the key — treat as missing, not a value
      sessionStorage.setItem(LAST_STATE_KEY, JSON.stringify('just a string'))
      localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'P', sessionId: 'S' }))
      expect(readLastState()).toEqual({ projectId: 'P', sessionId: 'S' })
    })

    it('rejects values with non-string / non-null projectId or sessionId', () => {
      sessionStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 42, sessionId: 'S' }))
      expect(readLastState()).toEqual({ projectId: null, sessionId: null })
    })

    it('accepts explicit nulls for projectId and sessionId', () => {
      sessionStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: null, sessionId: null }))
      expect(readLastState()).toEqual({ projectId: null, sessionId: null })
    })
  })

  describe('saveLastState', () => {
    it('writes to both sessionStorage and localStorage', () => {
      saveLastState('P', 'S')
      expect(sessionStorage.getItem(LAST_STATE_KEY)).toBe(JSON.stringify({ projectId: 'P', sessionId: 'S' }))
      expect(localStorage.getItem(LAST_STATE_KEY)).toBe(JSON.stringify({ projectId: 'P', sessionId: 'S' }))
    })

    it('accepts null for either field', () => {
      saveLastState(null, null)
      expect(JSON.parse(sessionStorage.getItem(LAST_STATE_KEY)!)).toEqual({ projectId: null, sessionId: null })
    })

    it('subsequent saves overwrite prior values', () => {
      saveLastState('P1', 'S1')
      saveLastState('P2', 'S2')
      expect(readLastState()).toEqual({ projectId: 'P2', sessionId: 'S2' })
    })

    it('continues writing to localStorage when sessionStorage.setItem throws', () => {
      // Simulate sessionStorage quota / private-mode failure
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
        throw new Error('QuotaExceededError')
      })
      saveLastState('P', 'S')
      // First call (sessionStorage) threw; second call (localStorage) should have written
      expect(spy).toHaveBeenCalledTimes(2)
      expect(localStorage.getItem(LAST_STATE_KEY)).toBe(JSON.stringify({ projectId: 'P', sessionId: 'S' }))
      spy.mockRestore()
    })
  })

  describe('integration: multi-tab scenario (the bug this fixes)', () => {
    it('one tab saving its own state does not clobber another tab\'s sessionStorage on refresh', () => {
      // Simulate Tab A saving its state
      saveLastState('tabA-P', 'tabA-S')

      // Now simulate "Tab B" overwriting localStorage only (as if it couldn't write sessionStorage).
      // In real browser this is achieved naturally: each tab has its own sessionStorage, but
      // localStorage is shared.
      localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'tabB-P', sessionId: 'tabB-S' }))

      // Tab A refreshes: its sessionStorage survives, localStorage has tabB's state.
      // Read should return tabA's state (sessionStorage wins).
      expect(readLastState()).toEqual({ projectId: 'tabA-P', sessionId: 'tabA-S' })
    })

    it('a fresh tab (empty sessionStorage) picks up localStorage fallback', () => {
      // Another tab previously saved state → localStorage has it → sessionStorage is empty
      // in this fresh tab.
      localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'shared-P', sessionId: 'shared-S' }))
      expect(readLastState()).toEqual({ projectId: 'shared-P', sessionId: 'shared-S' })
    })
  })
})
