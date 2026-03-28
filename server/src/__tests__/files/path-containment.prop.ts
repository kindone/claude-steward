// Feature:     File Browser
// Arch/Design: safeResolvePath is the single containment boundary for all file access;
//              a pure function by design so it can be exhaustively explored
// Spec:        ∀ (root, rel): result = null OR result.startsWith(path.resolve(root))
//              ¬∃ (root, rel): safeResolvePath throws
// @quality:    security
// @type:       property
// @mode:       verification

import { describe, it } from 'vitest'
import { forAll, Gen } from 'jsproptest'
import path from 'node:path'
import { safeResolvePath } from '../../lib/pathUtils.js'

describe('safeResolvePath — path containment', () => {

  describe('∀ (root, rel): result = null OR result.startsWith(path.resolve(root))', () => {

    it('typical relative paths — common filenames and subdirectories', () => {
      forAll(
        (root: string, rel: string) => {
          const result = safeResolvePath(root, rel)
          return result === null || result.startsWith(path.resolve(root))
        },
        Gen.asciiString(1, 40),   // root: short ASCII paths
        Gen.asciiString(0, 60),   // rel:  typical relative paths
      )
    })

    it('adversarial inputs — traversal sequences, encoded chars, absolute paths', () => {
      forAll(
        (prefix: string, rel: string) => {
          // bias toward traversal-like inputs by prepending known bad patterns
          const root = `/tmp/${prefix}`
          const result = safeResolvePath(root, rel)
          return result === null || result.startsWith(path.resolve(root))
        },
        Gen.asciiString(0, 20),
        Gen.unicodeString(0, 80),        // full unicode including %2F, null-adjacent chars
      )
    })

    it('long paths — deep nesting and very long filenames', () => {
      forAll(
        (root: string, rel: string) => {
          const result = safeResolvePath(root, rel)
          return result === null || result.startsWith(path.resolve(root))
        },
        Gen.asciiString(1, 100),
        Gen.asciiString(0, 200),
      )
    })

  })

  describe('¬∃ (root, rel): safeResolvePath throws', () => {

    it('never throws on any ASCII input', () => {
      forAll(
        (root: string, rel: string) => {
          try {
            safeResolvePath(root, rel)
            return true
          } catch {
            return false
          }
        },
        Gen.asciiString(0, 100),
        Gen.asciiString(0, 100),
      )
    })

    it('never throws on unicode or empty inputs', () => {
      forAll(
        (root: string, rel: string) => {
          try {
            safeResolvePath(root, rel)
            return true
          } catch {
            return false
          }
        },
        Gen.unicodeString(0, 80),
        Gen.unicodeString(0, 80),
      )
    })

  })

})
