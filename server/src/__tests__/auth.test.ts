// Feature:     Authentication
// Arch/Design: requireAuth middleware is the single auth boundary for all /api routes
// Spec:        ∀ request with missing/invalid session → 401; ∀ valid session → passes through
//              ∀ invalid auth: route handler body never executes; no side effects
// @quality:    security
// @type:       contract
// @mode:       verification

import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { authSessionQueries } from '../db/index.js'

const app = createApp()

const TEST_TOKEN = 'auth-test-session-token'
authSessionQueries.create(TEST_TOKEN)
const authCookie = `sid=${TEST_TOKEN}`

describe('requireAuth ↔ protected routes contract', () => {

  describe('producer guarantees (requireAuth middleware)', () => {
    it('missing cookie → 401', async () => {
      const res = await request(app).get('/api/sessions')
      expect(res.status).toBe(401)
    })

    it('invalid session token → 401', async () => {
      const res = await request(app)
        .get('/api/sessions')
        .set('Cookie', 'sid=invalid-token')
      expect(res.status).toBe(401)
    })

    it('valid session token → passes through to route (200)', async () => {
      const res = await request(app)
        .get('/api/sessions')
        .set('Cookie', authCookie)
      expect(res.status).toBe(200)
    })
  })

  describe('consumer assumptions (protected route handlers)', () => {
    it('route body never executes on auth failure — no side effects in DB', async () => {
      const before = await request(app).get('/api/sessions').set('Cookie', authCookie)
      const countBefore = (before.body as unknown[]).length

      // Attempt session creation without auth
      const res = await request(app).post('/api/sessions').send({ projectId: 'any' })
      expect(res.status).toBe(401)

      // Session count must be unchanged — route body did not run
      const after = await request(app).get('/api/sessions').set('Cookie', authCookie)
      expect((after.body as unknown[]).length).toBe(countBefore)
    })
  })

  describe('temporal invariants', () => {
    it('auth failure response contains no route-specific fields — auth fires before route handler', async () => {
      const res = await request(app).post('/api/sessions').send({ projectId: 'any' })
      expect(res.status).toBe(401)
      // Route handler would have returned id, title, project_id — none must be present
      expect(res.body).not.toHaveProperty('id')
      expect(res.body).not.toHaveProperty('title')
      expect(res.body.error).toBe('Unauthorized')
    })
  })

  describe('bilateral invariants', () => {
    it('∀ request: response is 401 XOR a route status — never both, never a 5xx from auth', async () => {
      const unauth = await request(app).get('/api/sessions')
      expect(unauth.status).toBe(401)
      expect(unauth.status).toBeLessThan(500)

      const auth = await request(app).get('/api/sessions').set('Cookie', authCookie)
      expect(auth.status).not.toBe(401)
      expect(auth.status).toBeLessThan(500)
    })
  })

})
