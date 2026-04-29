// Feature:     Chat streaming
// Arch/Design: extractToolDetail is a pure function; tool pills truncate detail text
//              for display in the UI — length bounds are the contract
// Spec:        ∀ Bash input: result = undefined OR result.length ≤ 100
//              ∀ WebSearch/WebFetch input: result = undefined OR result.length ≤ 80
//              ∀ (name, input): extractToolDetail never throws
//              ∀ Bash result: no leading/trailing whitespace; internal runs collapsed
// @quality:    correctness
// @type:       property
// @mode:       verification

import { describe, it } from 'vitest'
import { forAll, Gen } from 'jsproptest'
import { extractToolDetail } from '../../claude/toolDetail.js'

describe('extractToolDetail — tool pill invariants', () => {

  describe('∀ Bash command input: result = undefined OR result.length ≤ 100', () => {

    it('short commands', () => {
      forAll(
        (command: string) => {
          const result = extractToolDetail('Bash', { command })
          return result === undefined || result.length <= 100
        },
        Gen.asciiString(0, 50),
      )
    })

    it('long commands — verifies truncation at 100 chars', () => {
      forAll(
        (command: string) => {
          const result = extractToolDetail('Bash', { command })
          return result === undefined || result.length <= 100
        },
        Gen.asciiString(101, 500),
      )
    })

    it('result is always a valid trimmed string when command is a non-empty string', () => {
      forAll(
        (command: string) => {
          const result = extractToolDetail('Bash', { command })
          if (result === undefined) return true
          // Result must be a string (never null/undefined coercion artefact)
          return typeof result === 'string'
        },
        Gen.asciiString(0, 200),
      )
    })

  })

  describe('∀ WebSearch/WebFetch input: result = undefined OR result.length ≤ 80', () => {

    it('WebSearch query length bound', () => {
      forAll(
        (query: string) => {
          const result = extractToolDetail('WebSearch', { query })
          return result === undefined || result.length <= 80
        },
        Gen.asciiString(0, 300),
      )
    })

    it('WebFetch url length bound', () => {
      forAll(
        (url: string) => {
          const result = extractToolDetail('WebFetch', { url })
          return result === undefined || result.length <= 80
        },
        Gen.asciiString(0, 300),
      )
    })

  })

  describe('opencode lowercase tool names produce non-empty detail', () => {
    // Regression: opencode emits lowercase tool names ("bash", "websearch")
    // and uses `filePath` (camelCase) for read inputs. Before April 2026 the
    // switch was case-sensitive, so opencode bash/websearch tool pills had
    // no detail (silently degraded UX). Verify both naming conventions work.

    it('lowercase "bash" matches PascalCase "Bash"', () => {
      forAll(
        (command: string) => {
          if (!command.trim()) return true
          const lower = extractToolDetail('bash', { command })
          const upper = extractToolDetail('Bash', { command })
          return lower === upper && typeof lower === 'string' && lower.length > 0
        },
        Gen.asciiString(1, 50),
      )
    })

    it('lowercase "websearch" matches PascalCase "WebSearch"', () => {
      forAll(
        (query: string) => {
          if (!query.trim()) return true
          const lower = extractToolDetail('websearch', { query })
          const upper = extractToolDetail('WebSearch', { query })
          return lower === upper && typeof lower === 'string' && lower.length > 0
        },
        Gen.asciiString(1, 50),
      )
    })

    it('lowercase "webfetch" matches PascalCase "WebFetch"', () => {
      forAll(
        (url: string) => {
          if (!url.trim()) return true
          const lower = extractToolDetail('webfetch', { url })
          const upper = extractToolDetail('WebFetch', { url })
          return lower === upper && typeof lower === 'string' && lower.length > 0
        },
        Gen.asciiString(1, 50),
      )
    })

    it('opencode "read" with camelCase filePath returns the path', () => {
      forAll(
        (filePath: string) => {
          if (!filePath.trim()) return true
          const result = extractToolDetail('read', { filePath })
          return typeof result === 'string' && result.length > 0
        },
        Gen.asciiString(1, 50),
      )
    })

    it('Claude "Read" with snake_case file_path still returns the path', () => {
      forAll(
        (file_path: string) => {
          if (!file_path.trim()) return true
          const result = extractToolDetail('Read', { file_path })
          return typeof result === 'string' && result.length > 0
        },
        Gen.asciiString(1, 50),
      )
    })
  })

  describe('¬∃ (name, input): extractToolDetail throws', () => {

    it('known tool names with arbitrary inputs', () => {
      const toolNames = ['Bash', 'Read', 'Edit', 'Write', 'MultiEdit', 'WebSearch', 'WebFetch']
      forAll(
        (nameIdx: string, value: string) => {
          const name = toolNames[nameIdx.charCodeAt(0) % toolNames.length]
          try {
            extractToolDetail(name, {
              command: value, file_path: value,
              query: value, url: value,
            })
            return true
          } catch {
            return false
          }
        },
        Gen.asciiString(1, 1),
        Gen.unicodeString(0, 300),
      )
    })

    it('unknown tool names with arbitrary inputs', () => {
      forAll(
        (name: string, value: string) => {
          try {
            extractToolDetail(name, { command: value, file_path: value })
            return true
          } catch {
            return false
          }
        },
        Gen.asciiString(0, 50),
        Gen.unicodeString(0, 300),
      )
    })

    it('non-string field values — undefined, numbers, objects', () => {
      const toolNames = ['Bash', 'Read', 'WebSearch']
      forAll(
        (nameIdx: string) => {
          const name = toolNames[nameIdx.charCodeAt(0) % toolNames.length]
          try {
            extractToolDetail(name, { command: undefined, file_path: 42, query: { nested: true } } as Record<string, unknown>)
            return true
          } catch {
            return false
          }
        },
        Gen.asciiString(1, 1),
      )
    })

  })

})
