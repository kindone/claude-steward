// Feature:     Scheduler — REST API for schedule management
// Arch/Design: /api/schedules provides CRUD for per-session schedules; validation
//              must reject bad cron expressions and missing required fields before
//              they reach the DB
// Spec:        POST without sessionId → 400
//              POST with invalid cron → 400
//              POST with empty prompt → 400
//              POST with unknown sessionId → 404
//              POST valid → 201 with schedule object; GET confirms persistence
//              PATCH with invalid cron → 400; valid PATCH updates fields
//              DELETE unknown → 404; DELETE known → 204; subsequent GET omits it
//              GET ?sessionId=X returns only schedules for X
// @quality:    correctness
// @type:       example
// @mode:       verification

import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../app.js'
import { authSessionQueries } from '../../db/index.js'

const app = createApp()

const TEST_TOKEN = 'schedules-test-token'
authSessionQueries.create(TEST_TOKEN)
const authCookie = `sid=${TEST_TOKEN}`

let projectId: string
let sessionId: string
let otherSessionId: string

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-sched-'))
  const proj = await request(app)
    .post('/api/projects')
    .set('Cookie', authCookie)
    .send({ name: 'sched-test', path: tmpDir })
  projectId = proj.body.id

  const ses = await request(app)
    .post('/api/sessions')
    .set('Cookie', authCookie)
    .send({ projectId })
  sessionId = ses.body.id

  const ses2 = await request(app)
    .post('/api/sessions')
    .set('Cookie', authCookie)
    .send({ projectId })
  otherSessionId = ses2.body.id
})

// ── POST /api/schedules ───────────────────────────────────────────────────────

describe('POST /api/schedules', () => {

  it('rejects missing sessionId with 400', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ cron: '* * * * *', prompt: 'hello' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/sessionId/)
  })

  it('rejects invalid cron expression with 400', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId, cron: 'not-a-cron', prompt: 'hello' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/cron/)
  })

  it('rejects empty prompt with 400', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId, cron: '* * * * *', prompt: '' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/prompt/)
  })

  it('rejects whitespace-only prompt with 400', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId, cron: '* * * * *', prompt: '   ' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/prompt/)
  })

  it('rejects unknown sessionId with 404', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId: 'does-not-exist', cron: '* * * * *', prompt: 'hello' })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/[Ss]ession/)
  })

  it('creates schedule with 201 and returns full object', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId, cron: '0 9 * * 1-5', prompt: 'Stand-up reminder' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBeTruthy()
    expect(res.body.session_id).toBe(sessionId)
    expect(res.body.cron).toBe('0 9 * * 1-5')
    expect(res.body.prompt).toBe('Stand-up reminder')
    expect(res.body.enabled).toBe(1)
    expect(res.body.next_run_at).toBeGreaterThan(0)
  })

  it('created schedule appears in GET ?sessionId=X', async () => {
    const create = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId, cron: '*/15 * * * *', prompt: 'Ping' })
    expect(create.status).toBe(201)
    const createdId = create.body.id

    const list = await request(app)
      .get(`/api/schedules?sessionId=${sessionId}`)
      .set('Cookie', authCookie)
    expect(list.status).toBe(200)
    const ids = list.body.map((s: { id: string }) => s.id)
    expect(ids).toContain(createdId)
  })

})

// ── GET /api/schedules ────────────────────────────────────────────────────────

describe('GET /api/schedules', () => {

  it('returns only schedules for the requested sessionId', async () => {
    // Create one schedule on each session
    const s1 = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId, cron: '0 8 * * *', prompt: 'Session1 task' })
    const s2 = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId: otherSessionId, cron: '0 20 * * *', prompt: 'Session2 task' })

    const list = await request(app)
      .get(`/api/schedules?sessionId=${sessionId}`)
      .set('Cookie', authCookie)
    expect(list.status).toBe(200)
    const sessionIds = list.body.map((s: { session_id: string }) => s.session_id)
    expect(sessionIds).toContain(sessionId)
    // The other session's schedule must NOT appear
    const foreignIds = list.body.map((s: { id: string }) => s.id)
    expect(foreignIds).not.toContain(s2.body.id)
    // The created schedule for this session should appear
    expect(foreignIds).toContain(s1.body.id)
  })

  it('returns all schedules when no sessionId filter', async () => {
    const list = await request(app)
      .get('/api/schedules')
      .set('Cookie', authCookie)
    expect(list.status).toBe(200)
    expect(Array.isArray(list.body)).toBe(true)
  })

})

// ── PATCH /api/schedules/:id ──────────────────────────────────────────────────

describe('PATCH /api/schedules/:id', () => {

  it('returns 404 for unknown schedule id', async () => {
    const res = await request(app)
      .patch('/api/schedules/does-not-exist')
      .set('Cookie', authCookie)
      .send({ enabled: false })
    expect(res.status).toBe(404)
  })

  it('rejects invalid cron expression with 400', async () => {
    const create = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId, cron: '* * * * *', prompt: 'to patch' })
    const res = await request(app)
      .patch(`/api/schedules/${create.body.id}`)
      .set('Cookie', authCookie)
      .send({ cron: 'bad-cron' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/cron/)
  })

  it('rejects empty prompt with 400', async () => {
    const create = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId, cron: '* * * * *', prompt: 'to patch prompt' })
    const res = await request(app)
      .patch(`/api/schedules/${create.body.id}`)
      .set('Cookie', authCookie)
      .send({ prompt: '   ' })
    expect(res.status).toBe(400)
  })

  it('disabling a schedule persists in GET', async () => {
    const create = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId, cron: '0 10 * * *', prompt: 'To disable' })
    expect(create.body.enabled).toBe(1)

    const patch = await request(app)
      .patch(`/api/schedules/${create.body.id}`)
      .set('Cookie', authCookie)
      .send({ enabled: false })
    expect(patch.status).toBe(200)
    expect(patch.body.enabled).toBe(0)

    // Confirm via list
    const list = await request(app)
      .get(`/api/schedules?sessionId=${sessionId}`)
      .set('Cookie', authCookie)
    const found = list.body.find((s: { id: string }) => s.id === create.body.id)
    expect(found?.enabled).toBe(0)
  })

  it('updating cron recalculates next_run_at', async () => {
    const create = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId, cron: '0 1 * * *', prompt: 'Cron change test' })
    const originalNext = create.body.next_run_at

    const patch = await request(app)
      .patch(`/api/schedules/${create.body.id}`)
      .set('Cookie', authCookie)
      .send({ cron: '0 23 * * *' })
    expect(patch.status).toBe(200)
    expect(patch.body.cron).toBe('0 23 * * *')
    // next_run_at should have changed (different cron → different next fire time)
    expect(patch.body.next_run_at).not.toBe(originalNext)
    expect(patch.body.next_run_at).toBeGreaterThan(0)
  })

})

// ── DELETE /api/schedules/:id ─────────────────────────────────────────────────

describe('DELETE /api/schedules/:id', () => {

  it('returns 404 for unknown schedule id', async () => {
    const res = await request(app)
      .delete('/api/schedules/does-not-exist')
      .set('Cookie', authCookie)
    expect(res.status).toBe(404)
  })

  it('returns 204 and removes schedule from GET list', async () => {
    const create = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId, cron: '0 12 * * *', prompt: 'Delete me' })
    const schedId = create.body.id

    const del = await request(app)
      .delete(`/api/schedules/${schedId}`)
      .set('Cookie', authCookie)
    expect(del.status).toBe(204)

    const list = await request(app)
      .get(`/api/schedules?sessionId=${sessionId}`)
      .set('Cookie', authCookie)
    const ids = list.body.map((s: { id: string }) => s.id)
    expect(ids).not.toContain(schedId)
  })

  it('second DELETE on same id returns 404', async () => {
    const create = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId, cron: '0 13 * * *', prompt: 'Delete twice' })
    const schedId = create.body.id

    await request(app).delete(`/api/schedules/${schedId}`).set('Cookie', authCookie)
    const del2 = await request(app)
      .delete(`/api/schedules/${schedId}`)
      .set('Cookie', authCookie)
    expect(del2.status).toBe(404)
  })

})

// ── POST /api/schedules/:id/run ───────────────────────────────────────────────

describe('POST /api/schedules/:id/run', () => {

  it('returns 404 for unknown schedule id', async () => {
    const res = await request(app)
      .post('/api/schedules/does-not-exist/run')
      .set('Cookie', authCookie)
    expect(res.status).toBe(404)
  })

  it('returns 200 ok for a known schedule (fire is async, response is immediate)', async () => {
    const create = await request(app)
      .post('/api/schedules')
      .set('Cookie', authCookie)
      .send({ sessionId, cron: '0 0 1 1 *', prompt: 'Manual run test' })

    const run = await request(app)
      .post(`/api/schedules/${create.body.id}/run`)
      .set('Cookie', authCookie)
    expect(run.status).toBe(200)
    expect(run.body.ok).toBe(true)
  })

})
