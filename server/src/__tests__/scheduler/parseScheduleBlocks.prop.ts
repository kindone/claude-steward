// Feature:     Scheduler — inline schedule creation from Claude responses
// Arch/Design: extractScheduleBlocks is a pure function; Claude embeds <schedule>
//              JSON blocks in response text; the function must parse valid blocks,
//              reject invalid ones, and always strip the tags from the output text
// Spec:        ∀ text: extractScheduleBlocks never throws
//              ∀ text: strippedText contains no <schedule>…</schedule> tags
//              ∀ valid block (valid cron + non-empty prompt): schedule appears in result
//              ∀ invalid block (bad JSON | invalid cron | missing fields): block is silently dropped
//              ∀ text with no blocks: strippedText equals trimmed original
// @quality:    correctness, reliability
// @type:       property
// @mode:       verification

import { describe, it, expect } from 'vitest'
import { forAll, Gen } from 'jsproptest'
import { extractScheduleBlocks } from '../../lib/parseScheduleBlocks.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_CRONS = [
  '* * * * *',
  '0 9 * * 1-5',
  '30 14 1 * *',
  '0 0 * * 0',
  '*/5 * * * *',
  '0 8 * * 1',
]

function makeBlock(json: string): string {
  return `<schedule>${json}</schedule>`
}

function hasScheduleTag(text: string): boolean {
  return /<schedule>[\s\S]*?<\/schedule>/i.test(text)
}

// ── Properties ────────────────────────────────────────────────────────────────

describe('extractScheduleBlocks — parser invariants', () => {

  describe('¬∃ text: extractScheduleBlocks throws', () => {

    it('arbitrary ASCII text never throws', () => {
      forAll(
        (text: string) => {
          try {
            extractScheduleBlocks(text)
            return true
          } catch {
            return false
          }
        },
        Gen.asciiString(0, 500),
      )
    })

    it('arbitrary unicode text never throws', () => {
      forAll(
        (text: string) => {
          try {
            extractScheduleBlocks(text)
            return true
          } catch {
            return false
          }
        },
        Gen.unicodeString(0, 300),
      )
    })

    it('text with injected <schedule> tags never throws', () => {
      forAll(
        (prefix: string, inner: string, suffix: string) => {
          const text = `${prefix}<schedule>${inner}</schedule>${suffix}`
          try {
            extractScheduleBlocks(text)
            return true
          } catch {
            return false
          }
        },
        Gen.asciiString(0, 100),
        Gen.unicodeString(0, 200),
        Gen.asciiString(0, 100),
      )
    })

  })

  describe('∀ text: strippedText contains no <schedule> tags', () => {

    it('plain text — no tags to begin with', () => {
      forAll(
        (text: string) => {
          const { strippedText } = extractScheduleBlocks(text)
          return !hasScheduleTag(strippedText)
        },
        Gen.asciiString(0, 300),
      )
    })

    it('text wrapping arbitrary JSON', () => {
      forAll(
        (prefix: string, inner: string, suffix: string) => {
          const text = `${prefix}<schedule>${inner}</schedule>${suffix}`
          const { strippedText } = extractScheduleBlocks(text)
          return !hasScheduleTag(strippedText)
        },
        Gen.asciiString(0, 80),
        Gen.asciiString(0, 200),
        Gen.asciiString(0, 80),
      )
    })

    it('multiple blocks are all stripped', () => {
      for (const cron of VALID_CRONS.slice(0, 3)) {
        const block = makeBlock(JSON.stringify({ cron, prompt: 'test', label: 'lbl' }))
        const text = `before ${block} middle ${block} after`
        const { strippedText } = extractScheduleBlocks(text)
        expect(hasScheduleTag(strippedText)).toBe(false)
      }
    })

  })

  describe('∀ valid block: schedule is extracted with correct fields', () => {

    it('cron + prompt yields one schedule entry', () => {
      for (const cron of VALID_CRONS) {
        const prompt = 'Do something useful'
        const label = 'My label'
        const text = makeBlock(JSON.stringify({ cron, prompt, label }))
        const { schedules } = extractScheduleBlocks(text)
        expect(schedules).toHaveLength(1)
        expect(schedules[0].cron).toBe(cron)
        expect(schedules[0].prompt).toBe(prompt)
        expect(schedules[0].label).toBe(label)
        expect(schedules[0].once).toBe(false)
      }
    })

    it('once: true is preserved', () => {
      const cron = '0 9 * * 1'
      const text = makeBlock(JSON.stringify({ cron, prompt: 'Ping me', once: true }))
      const { schedules } = extractScheduleBlocks(text)
      expect(schedules).toHaveLength(1)
      expect(schedules[0].once).toBe(true)
    })

    it('once: false is preserved', () => {
      const cron = '0 9 * * 1'
      const text = makeBlock(JSON.stringify({ cron, prompt: 'Ping me', once: false }))
      const { schedules } = extractScheduleBlocks(text)
      expect(schedules).toHaveLength(1)
      expect(schedules[0].once).toBe(false)
    })

    it('label defaults to prompt.slice(0,60) when omitted', () => {
      const cron = '* * * * *'
      const prompt = 'A'.repeat(80)
      const text = makeBlock(JSON.stringify({ cron, prompt }))
      const { schedules } = extractScheduleBlocks(text)
      expect(schedules).toHaveLength(1)
      expect(schedules[0].label).toBe(prompt.slice(0, 60))
    })

    it('label defaults to full prompt when prompt shorter than 60 chars', () => {
      const cron = '* * * * *'
      const prompt = 'Short prompt'
      const text = makeBlock(JSON.stringify({ cron, prompt }))
      const { schedules } = extractScheduleBlocks(text)
      expect(schedules[0].label).toBe(prompt)
    })

    it('surrounding text is preserved (minus the block) in strippedText', () => {
      const cron = '0 8 * * 1-5'
      const block = makeBlock(JSON.stringify({ cron, prompt: 'Stand-up reminder' }))
      const text = `Here is your schedule:${block}Have a great day!`
      const { strippedText } = extractScheduleBlocks(text)
      expect(strippedText).toContain('Here is your schedule:')
      expect(strippedText).toContain('Have a great day!')
    })

    it('multiple valid blocks are all extracted', () => {
      const block1 = makeBlock(JSON.stringify({ cron: '0 9 * * 1-5', prompt: 'Morning', label: 'A' }))
      const block2 = makeBlock(JSON.stringify({ cron: '0 17 * * 1-5', prompt: 'Evening', label: 'B' }))
      const { schedules } = extractScheduleBlocks(`${block1} ${block2}`)
      expect(schedules).toHaveLength(2)
      expect(schedules[0].label).toBe('A')
      expect(schedules[1].label).toBe('B')
    })

  })

  describe('∀ invalid block: block is silently dropped (no throw, no schedule)', () => {

    it('malformed JSON is dropped', () => {
      const text = makeBlock('{not valid json}')
      const { schedules, strippedText } = extractScheduleBlocks(text)
      expect(schedules).toHaveLength(0)
      expect(hasScheduleTag(strippedText)).toBe(false)
    })

    it('invalid cron expression is dropped', () => {
      const text = makeBlock(JSON.stringify({ cron: 'not-a-cron', prompt: 'something' }))
      const { schedules } = extractScheduleBlocks(text)
      expect(schedules).toHaveLength(0)
    })

    it('missing cron field is dropped', () => {
      const text = makeBlock(JSON.stringify({ prompt: 'no cron here' }))
      const { schedules } = extractScheduleBlocks(text)
      expect(schedules).toHaveLength(0)
    })

    it('missing prompt field is dropped', () => {
      const text = makeBlock(JSON.stringify({ cron: '* * * * *' }))
      const { schedules } = extractScheduleBlocks(text)
      expect(schedules).toHaveLength(0)
    })

    it('empty prompt string is dropped', () => {
      const text = makeBlock(JSON.stringify({ cron: '* * * * *', prompt: '' }))
      const { schedules } = extractScheduleBlocks(text)
      expect(schedules).toHaveLength(0)
    })

    it('whitespace-only prompt is dropped', () => {
      const text = makeBlock(JSON.stringify({ cron: '* * * * *', prompt: '   ' }))
      const { schedules } = extractScheduleBlocks(text)
      expect(schedules).toHaveLength(0)
    })

    it('non-string cron type is dropped', () => {
      const text = makeBlock(JSON.stringify({ cron: 42, prompt: 'hello' }))
      const { schedules } = extractScheduleBlocks(text)
      expect(schedules).toHaveLength(0)
    })

    it('arbitrary random JSON objects without required fields are dropped', () => {
      forAll(
        (seed: string) => {
          // Generate a JSON object that deliberately lacks 'cron' and 'prompt'
          const obj: Record<string, string> = { label: seed, extra: seed.slice(0, 5) }
          const text = makeBlock(JSON.stringify(obj))
          const { schedules } = extractScheduleBlocks(text)
          return schedules.length === 0
        },
        Gen.asciiString(0, 50),
      )
    })

  })

  describe('∀ text with no blocks: output is stable', () => {

    it('plain text is returned trimmed with no schedules', () => {
      forAll(
        (text: string) => {
          // Only run on strings that don't contain '<schedule>' to avoid false positives
          if (text.includes('<schedule>')) return true
          const { schedules, strippedText } = extractScheduleBlocks(text)
          return schedules.length === 0 && strippedText === text.trim()
        },
        Gen.asciiString(1, 200),
      )
    })

  })

})
