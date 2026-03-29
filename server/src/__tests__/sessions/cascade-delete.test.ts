// Feature:     Session management
// Arch/Design: DELETE /api/sessions/:id removes the session row; messages reference
//              sessions via FK but are deleted via explicit deleteBySessionId call in the route
// Spec:        ∀ session delete: all messages for that session are removed from DB
//              ∀ session delete: sibling sessions and their messages are unaffected
// @quality:    correctness
// @type:       example
// @mode:       verification

import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { v4 as uuidv4 } from 'uuid'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createApp } from '../../app.js'
import { authSessionQueries, projectQueries, sessionQueries, messageQueries } from '../../db/index.js'

const app = createApp()
const TEST_TOKEN = 'cascade-delete-test-token'
authSessionQueries.create(TEST_TOKEN)
const authCookie = `sid=${TEST_TOKEN}`

let projectId: string

beforeAll(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-test-'))
  projectId = uuidv4()
  projectQueries.create(projectId, 'cascade-test', tmpDir)
})

describe('session delete — cascade to messages', () => {

  it('deleting a session removes all its messages', async () => {
    // Create session with messages directly via queries
    const sessionId = uuidv4()
    sessionQueries.create(sessionId, 'to be deleted', projectId)
    messageQueries.insert(uuidv4(), sessionId, 'user', 'hello')
    messageQueries.insert(uuidv4(), sessionId, 'assistant', 'world')

    // Verify messages exist before delete
    expect(messageQueries.listBySessionId(sessionId)).toHaveLength(2)

    // Delete via HTTP route (which also calls deleteBySessionId)
    const res = await request(app)
      .delete(`/api/sessions/${sessionId}`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(204)

    // Messages must be gone
    expect(messageQueries.listBySessionId(sessionId)).toHaveLength(0)
  })

  it('deleting one session does not affect sibling sessions or their messages', async () => {
    const sessionA = uuidv4()
    const sessionB = uuidv4()
    sessionQueries.create(sessionA, 'session A', projectId)
    sessionQueries.create(sessionB, 'session B', projectId)

    const msgA = uuidv4()
    const msgB = uuidv4()
    messageQueries.insert(msgA, sessionA, 'user', 'message in A')
    messageQueries.insert(msgB, sessionB, 'user', 'message in B')

    // Delete only session A
    await request(app).delete(`/api/sessions/${sessionA}`).set('Cookie', authCookie)

    // Session B and its message must be intact
    expect(sessionQueries.findById(sessionB)).toBeDefined()
    const remaining = messageQueries.listBySessionId(sessionB)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(msgB)
  })

  it('deleting an already-deleted session returns 404', async () => {
    const sessionId = uuidv4()
    sessionQueries.create(sessionId, 'ephemeral', projectId)

    await request(app).delete(`/api/sessions/${sessionId}`).set('Cookie', authCookie)
    const res = await request(app).delete(`/api/sessions/${sessionId}`).set('Cookie', authCookie)
    expect(res.status).toBe(404)
  })

})
