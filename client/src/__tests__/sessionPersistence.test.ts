// Feature:     Per-tab session persistence (refresh + browser-restart resume)
// Arch/Design: URL hash (per-tab, survives browser restart) primary,
//              sessionStorage (per-tab) secondary, localStorage (cross-tab)
//              fallback. See client/src/lib/sessionPersistence.ts for the
//              full rationale (Android browser restart wipes sessionStorage).
// Spec:        ∀ refresh:        read returns the URL hash if both keys present
//              ∀ browser restart: hash survives, used as the primary source
//              ∀ fresh tab w/o hash: read returns sessionStorage if set, else localStorage
//              ∀ corrupt/partial:  read returns EMPTY, no throw
//              ∀ one-store failure: other stores still written
// @quality:    correctness
// @type:       example
// @mode:       verification

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  readLastState,
  saveLastState,
  readHashState,
  writeHashState,
  LAST_STATE_KEY,
} from '../lib/sessionPersistence'

function clearHash(): void {
  // Use replaceState directly — assigning to window.location.hash adds a
  // history entry in JSDOM and can leave a `#` behind.
  const url = new URL(window.location.href)
  url.hash = ''
  window.history.replaceState({}, '', url.toString())
}

describe('sessionPersistence', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    clearHash()
  })

  // ── readLastState — priority chain ──────────────────────────────────────

  describe('readLastState', () => {
    it('returns nulls when nothing is stored anywhere', () => {
      expect(readLastState()).toEqual({ projectId: null, sessionId: null })
    })

    it('prefers URL hash over sessionStorage and localStorage', () => {
      writeHashState('hash-P', 'hash-S')
      sessionStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'ss-P', sessionId: 'ss-S' }))
      localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'ls-P', sessionId: 'ls-S' }))
      expect(readLastState()).toEqual({ projectId: 'hash-P', sessionId: 'hash-S' })
    })

    it('falls back to sessionStorage when hash is empty', () => {
      sessionStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'tab-P', sessionId: 'tab-S' }))
      localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'other-P', sessionId: 'other-S' }))
      expect(readLastState()).toEqual({ projectId: 'tab-P', sessionId: 'tab-S' })
    })

    it('falls back to localStorage when hash and sessionStorage are both empty', () => {
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
      expect(readLastState()).toEqual({ projectId: 'good-P', sessionId: 'good-S' })
    })

    it('rejects stored values that are not shaped like LastState', () => {
      sessionStorage.setItem(LAST_STATE_KEY, JSON.stringify('just a string'))
      localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'P', sessionId: 'S' }))
      expect(readLastState()).toEqual({ projectId: 'P', sessionId: 'S' })
    })

    it('rejects values with non-string / non-null projectId or sessionId', () => {
      sessionStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 42, sessionId: 'S' }))
      expect(readLastState()).toEqual({ projectId: null, sessionId: null })
    })

    it('accepts explicit nulls for projectId and sessionId in storage', () => {
      sessionStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: null, sessionId: null }))
      expect(readLastState()).toEqual({ projectId: null, sessionId: null })
    })
  })

  // ── saveLastState — writes everywhere ────────────────────────────────────

  describe('saveLastState', () => {
    it('writes to URL hash, sessionStorage, and localStorage', () => {
      saveLastState('P', 'S')
      expect(readHashState()).toEqual({ projectId: 'P', sessionId: 'S' })
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
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
        throw new Error('QuotaExceededError')
      })
      saveLastState('P', 'S')
      expect(spy).toHaveBeenCalledTimes(2)
      expect(localStorage.getItem(LAST_STATE_KEY)).toBe(JSON.stringify({ projectId: 'P', sessionId: 'S' }))
      spy.mockRestore()
    })

    it('does not write hash when sessionStorage.setItem throws (separate code paths)', () => {
      // Verifies that storage failures don't break hash writing — they're independent.
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
      saveLastState('P', 'S')
      expect(readHashState()).toEqual({ projectId: 'P', sessionId: 'S' })
      spy.mockRestore()
    })
  })

  // ── readHashState / writeHashState — direct hash semantics ──────────────

  describe('readHashState', () => {
    it('returns null when hash is empty', () => {
      expect(readHashState()).toBeNull()
    })

    it('returns parsed values when both keys are present', () => {
      window.history.replaceState({}, '', '/#project=hashP&session=hashS')
      expect(readHashState()).toEqual({ projectId: 'hashP', sessionId: 'hashS' })
    })

    it('returns null when only project is present (partial hash treated as missing)', () => {
      window.history.replaceState({}, '', '/#project=hashP')
      expect(readHashState()).toBeNull()
    })

    it('returns null when only session is present', () => {
      window.history.replaceState({}, '', '/#session=hashS')
      expect(readHashState()).toBeNull()
    })

    it('ignores unrelated hash keys', () => {
      window.history.replaceState({}, '', '/#otherkey=abc&project=P&session=S')
      expect(readHashState()).toEqual({ projectId: 'P', sessionId: 'S' })
    })
  })

  describe('writeHashState', () => {
    it('writes both keys to the hash', () => {
      writeHashState('P', 'S')
      expect(window.location.hash).toContain('project=P')
      expect(window.location.hash).toContain('session=S')
    })

    it('does not add a history entry (uses replaceState)', () => {
      const before = window.history.length
      writeHashState('P', 'S')
      writeHashState('P2', 'S2')
      writeHashState('P3', 'S3')
      expect(window.history.length).toBe(before)
    })

    it('preserves unrelated hash keys', () => {
      window.history.replaceState({}, '', '/#anchor=top')
      writeHashState('P', 'S')
      const params = new URLSearchParams(window.location.hash.slice(1))
      expect(params.get('anchor')).toBe('top')
      expect(params.get('project')).toBe('P')
      expect(params.get('session')).toBe('S')
    })

    it('preserves the URL pathname and search', () => {
      window.history.replaceState({}, '', '/some/path?foo=bar')
      writeHashState('P', 'S')
      expect(window.location.pathname).toBe('/some/path')
      expect(window.location.search).toBe('?foo=bar')
    })

    it('removes both steward keys when called with nulls', () => {
      writeHashState('P', 'S')
      writeHashState(null, null)
      expect(readHashState()).toBeNull()
    })

    it('removes both steward keys when called with one null (no half-written hash)', () => {
      writeHashState('P', 'S')
      writeHashState('P', null)
      // After a one-null call, hash should not contain a stale partial pair.
      expect(readHashState()).toBeNull()
    })
  })

  // ── Integration: multi-tab + browser-restart scenarios ──────────────────

  describe('multi-tab + browser restart scenarios (the bugs this fixes)', () => {
    it('one tab saving state does not clobber another tab\'s view on refresh', () => {
      // Tab A saves its state — writes hash, sessionStorage, localStorage
      saveLastState('tabA-P', 'tabA-S')

      // Tab B (different sessionStorage in real browser; simulate by overwriting localStorage only)
      localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'tabB-P', sessionId: 'tabB-S' }))

      // Tab A refreshes: hash and sessionStorage still have its own state, localStorage has tabB's.
      // Read should return tabA's state (hash wins).
      expect(readLastState()).toEqual({ projectId: 'tabA-P', sessionId: 'tabA-S' })
    })

    it('Android browser-restart: sessionStorage wiped, hash survives → resumes per-tab', () => {
      // Tab A saves state. All three sources have it.
      saveLastState('tabA-P', 'tabA-S')

      // Simulate browser app close + reopen on Android: sessionStorage wiped for the
      // restored tab, but the URL is preserved by the browser's tab restoration.
      sessionStorage.clear()

      // Another tab's last-write may have leaked into shared localStorage:
      localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'tabB-P', sessionId: 'tabB-S' }))

      // Tab A's URL still has its hash → restore should land on Tab A's session,
      // not Tab B's. This is the Android-specific bug the hash store fixes.
      expect(readLastState()).toEqual({ projectId: 'tabA-P', sessionId: 'tabA-S' })
    })

    it('a fresh tab (no hash, empty sessionStorage) picks up localStorage fallback', () => {
      localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId: 'shared-P', sessionId: 'shared-S' }))
      expect(readLastState()).toEqual({ projectId: 'shared-P', sessionId: 'shared-S' })
    })
  })
})
