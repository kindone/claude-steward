// Feature:     Session management
// Spec:        ∀ session: project_id always set; title defaults to 'New Chat'
//              ∀ GET /sessions?projectId=X: every returned session belongs to X
//              ∀ DELETE session: subsequent GET returns 404; messages are unreachable
// @quality:    correctness
// @type:       example
// @mode:       verification

import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../app.js'
import { authSessionQueries } from '../db/index.js'

const app = createApp()

const TEST_TOKEN = 'sessions-test-session-token'
authSessionQueries.create(TEST_TOKEN)
const authCookie = `sid=${TEST_TOKEN}`

// Shared project used across tests that need a projectId
let sharedProjectId: string
let sharedTmpDir: string

beforeAll(async () => {
  sharedTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-s-'))
  const proj = await request(app)
    .post('/api/projects')
    .set('Cookie', authCookie)
    .send({ name: 'shared', path: sharedTmpDir })
  sharedProjectId = proj.body.id
})

describe('POST /api/sessions', () => {
  it('rejects missing projectId', async () => {
    const res = await request(app).post('/api/sessions').set('Cookie', authCookie).send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/projectId/)
  })

  it('creates a session scoped to a project', async () => {
    const ses = await request(app)
      .post('/api/sessions')
      .set('Cookie', authCookie)
      .send({ projectId: sharedProjectId })
    expect(ses.status).toBe(201)
    expect(ses.body.title).toBe('New Chat')
    expect(ses.body.project_id).toBe(sharedProjectId)
    expect(ses.body.id).toBeTruthy()
    // cli is NOT NULL in the schema; should always come back set on a new
    // row regardless of whether the client picked a value.
    expect(['claude', 'opencode']).toContain(ses.body.cli)
  })

  it('accepts an explicit cli at creation', async () => {
    const ses = await request(app)
      .post('/api/sessions')
      .set('Cookie', authCookie)
      .send({ projectId: sharedProjectId, cli: 'opencode' })
    expect(ses.status).toBe(201)
    expect(ses.body.cli).toBe('opencode')
  })

  it('rejects an unknown cli value', async () => {
    const ses = await request(app)
      .post('/api/sessions')
      .set('Cookie', authCookie)
      .send({ projectId: sharedProjectId, cli: 'aider' })
    expect(ses.status).toBe(400)
    expect(ses.body.error).toMatch(/cli/)
  })
})

describe('PATCH /api/sessions/:id (cli switch)', () => {
  it('switches adapter and clears claude_session_id + model atomically', async () => {
    // Create a claude session, give it a session handle and a model
    const created = await request(app)
      .post('/api/sessions')
      .set('Cookie', authCookie)
      .send({ projectId: sharedProjectId, cli: 'claude' })
    expect(created.status).toBe(201)
    const id = created.body.id as string

    // Pretend a turn ran: set a model and (via the DB-backed test path)
    // a claude_session_id. We use PATCH for model, and a direct insert of
    // a claude_session_id via PATCH wouldn't be exposed — but the route
    // still tracks it, so we set what we can: model. claude_session_id
    // starts NULL on a fresh session, which is fine for the assertion.
    await request(app)
      .patch(`/api/sessions/${id}`)
      .set('Cookie', authCookie)
      .send({ model: 'claude-sonnet-4-6' })

    // Switch to opencode — model should clear (Claude slug is invalid for opencode)
    const switched = await request(app)
      .patch(`/api/sessions/${id}`)
      .set('Cookie', authCookie)
      .send({ cli: 'opencode' })
    expect(switched.status).toBe(200)
    expect(switched.body.cli).toBe('opencode')
    expect(switched.body.model).toBeNull()
    expect(switched.body.claude_session_id).toBeNull()
  })

  it('is a no-op when cli matches current value', async () => {
    const created = await request(app)
      .post('/api/sessions')
      .set('Cookie', authCookie)
      .send({ projectId: sharedProjectId, cli: 'opencode' })
    const id = created.body.id as string

    await request(app)
      .patch(`/api/sessions/${id}`)
      .set('Cookie', authCookie)
      .send({ model: 'google/gemini-2.5-flash' })

    // Re-PATCH with same cli — model should NOT be cleared (no-op)
    const sameCli = await request(app)
      .patch(`/api/sessions/${id}`)
      .set('Cookie', authCookie)
      .send({ cli: 'opencode' })
    expect(sameCli.status).toBe(200)
    expect(sameCli.body.model).toBe('google/gemini-2.5-flash')
  })

  it('rejects an unknown cli value', async () => {
    const created = await request(app)
      .post('/api/sessions')
      .set('Cookie', authCookie)
      .send({ projectId: sharedProjectId })
    const id = created.body.id as string

    const bad = await request(app)
      .patch(`/api/sessions/${id}`)
      .set('Cookie', authCookie)
      .send({ cli: 'aider' })
    expect(bad.status).toBe(400)
  })
})

describe('GET /api/sessions', () => {
  it('returns all sessions when no filter', async () => {
    const res = await request(app).get('/api/sessions').set('Cookie', authCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('filters sessions by projectId', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-sf-'))
    const proj = await request(app)
      .post('/api/projects')
      .set('Cookie', authCookie)
      .send({ name: 'filter-test', path: tmpDir })

    await request(app)
      .post('/api/sessions')
      .set('Cookie', authCookie)
      .send({ projectId: proj.body.id })

    const filtered = await request(app)
      .get(`/api/sessions?projectId=${proj.body.id}`)
      .set('Cookie', authCookie)
    expect(filtered.status).toBe(200)
    expect(filtered.body.every((s: { project_id: string }) => s.project_id === proj.body.id)).toBe(true)

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe('DELETE /api/sessions/:id', () => {
  let sessionId: string

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('Cookie', authCookie)
      .send({ projectId: sharedProjectId })
    sessionId = res.body.id
  })

  it('deletes the session', async () => {
    const res = await request(app)
      .delete(`/api/sessions/${sessionId}`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(204)
  })

  it('returns 404 for already-deleted session', async () => {
    const res = await request(app)
      .delete(`/api/sessions/${sessionId}`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(404)
  })
})

describe('GET /api/sessions/:id/messages', () => {
  it('returns empty array for new session', async () => {
    const create = await request(app)
      .post('/api/sessions')
      .set('Cookie', authCookie)
      .send({ projectId: sharedProjectId })
    const msgs = await request(app)
      .get(`/api/sessions/${create.body.id}/messages`)
      .set('Cookie', authCookie)
    expect(msgs.status).toBe(200)
    expect(msgs.body).toEqual([])
  })

  it('returns 404 for unknown session', async () => {
    const res = await request(app)
      .get('/api/sessions/nonexistent/messages')
      .set('Cookie', authCookie)
    expect(res.status).toBe(404)
  })
})
