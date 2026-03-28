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
