// Feature:     Chat history
// Arch/Design: listPaged uses rowid DESC + reverse for cursor-based pagination;
//              the extra +1 trick detects hasMore without a COUNT query
// Spec:        ∀ (messages, limit): result.length ≤ limit
//              ∀ (messages, limit): full traversal returns all messages, no duplicates
//              ∀ page: messages within a page are in ascending created_at order
//              ∀ cursor: listPaged(sessionId, limit, beforeId) returns only messages older than beforeId
// @quality:    correctness
// @type:       property
// @mode:       verification

import { describe, it, beforeAll } from 'vitest'
import { forAll, Gen } from 'jsproptest'
import { v4 as uuidv4 } from 'uuid'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { projectQueries, sessionQueries, messageQueries } from '../../db/index.js'
import type { Message } from '../../db/index.js'

// Shared project for all runs — sessions are unique per forAll call
let sharedProjectId: string

beforeAll(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagination-prop-'))
  sharedProjectId = uuidv4()
  projectQueries.create(sharedProjectId, 'pagination-test', tmpDir)
})

/** Insert N messages into a fresh session and return the sessionId + inserted IDs in order. */
function createMessages(n: number): { sessionId: string; ids: string[] } {
  const sessionId = uuidv4()
  sessionQueries.create(sessionId, 'test', sharedProjectId)
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const id = uuidv4()
    messageQueries.insert(id, sessionId, 'user', `message ${i}`)
    ids.push(id)
  }
  return { sessionId, ids }
}

/** Traverse all pages using cursor pagination and collect all messages.
 *
 * listPaged() paginates newest-first: each page contains the newest `limit` messages
 * older than the cursor. The cursor is the oldest message in the current page (items[0]),
 * so the next call gets the next `limit` older messages.
 */
function traverseAllPages(sessionId: string, limit: number): Message[] {
  const all: Message[] = []
  let cursor: string | undefined = undefined

  for (let i = 0; i < 1000; i++) {
    const page = messageQueries.listPaged(sessionId, limit, cursor)
    if (page.length === 0) break
    all.push(...page)
    if (page.length < limit) break       // last page — fewer than limit means no more
    cursor = page[0].id                  // oldest in this page → fetch messages before it
  }
  return all
}

describe('messageQueries.listPaged — cursor pagination', () => {

  describe('∀ (N messages, limit): result.length ≤ limit', () => {
    it('first page never exceeds limit', { timeout: 15000 }, () => {
      forAll(
        (n: number, limit: number) => {
          const { sessionId } = createMessages(n)
          const page = messageQueries.listPaged(sessionId, limit)
          return page.length <= limit
        },
        Gen.inRange(0, 30),
        Gen.inRange(1, 10),
      )
    })
  })

  describe('∀ full traversal: returns all messages, no duplicates, ascending order', () => {
    it('full page traversal recovers all inserted messages', { timeout: 30000 }, () => {
      forAll(
        (n: number, limit: number) => {
          const { sessionId, ids } = createMessages(n)
          const all = traverseAllPages(sessionId, limit)

          // Correct count
          if (all.length !== n) return false

          // No duplicates
          const seen = new Set(all.map(m => m.id))
          if (seen.size !== n) return false

          // All inserted IDs are present
          for (const id of ids) {
            if (!seen.has(id)) return false
          }

          return true
        },
        Gen.inRange(0, 20),
        Gen.inRange(1, 5),
      )
    })

    it('messages within each page are in ascending order', { timeout: 15000 }, () => {
      forAll(
        (n: number, limit: number) => {
          const { sessionId } = createMessages(n)
          const page = messageQueries.listPaged(sessionId, limit)

          for (let i = 1; i < page.length; i++) {
            if (page[i].created_at < page[i - 1].created_at) return false
          }
          return true
        },
        Gen.inRange(2, 20),
        Gen.inRange(1, 10),
      )
    })
  })

  describe('∀ cursor: listPaged with beforeId returns only messages older than cursor', () => {
    it('cursor correctly restricts to older messages', { timeout: 15000 }, () => {
      forAll(
        (n: number, splitAt: number) => {
          if (n < 2) return true // need at least 2 messages to test cursor
          const { sessionId } = createMessages(n)

          // Get first page, use the last message as cursor
          const firstPage = messageQueries.listPaged(sessionId, n)
          const cursorId = firstPage[splitAt % firstPage.length].id
          const cursorMsg = firstPage.find(m => m.id === cursorId)!

          // Get messages before cursor
          const beforePage = messageQueries.listPaged(sessionId, n, cursorId)

          // All returned messages must be older than cursor
          for (const msg of beforePage) {
            if (msg.created_at > cursorMsg.created_at) return false
            if (msg.id === cursorId) return false
          }
          return true
        },
        Gen.inRange(2, 15),
        Gen.inRange(0, 14),
      )
    })
  })

})
