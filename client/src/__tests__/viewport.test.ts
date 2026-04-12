// @quality: correctness
// @type: example

import { describe, it, expect, vi, afterEach } from 'vitest'
import { isBelowTailwindMd } from '../lib/viewport'

describe('isBelowTailwindMd', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns false when matchMedia reports wide viewport', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    expect(isBelowTailwindMd()).toBe(false)
  })

  it('returns true when matchMedia reports narrow viewport', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(max-width: 767px)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    expect(isBelowTailwindMd()).toBe(true)
  })
})
