// Feature:     Authentication
// Arch/Design: requireAuth middleware is the single auth boundary for all /api routes
// Spec:        ∀ request with missing/invalid session → 401; ∀ valid session → passes through
// @quality:    security
// @type:       example
// @mode:       verification

import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { authSessionQueries } from '../db/index.js'

const app = createApp()

const TEST_TOKEN = 'auth-test-session-token'
authSessionQueries.create(TEST_TOKEN)
const authCookie = `sid=${TEST_TOKEN}`

describe('auth middleware', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/sessions')
    expect(res.status).toBe(401)
  })

  it('rejects invalid session cookie', async () => {
    const res = await request(app)
      .get('/api/sessions')
      .set('Cookie', 'sid=invalid-token')
    expect(res.status).toBe(401)
  })

  it('passes through with valid session cookie', async () => {
    const res = await request(app)
      .get('/api/sessions')
      .set('Cookie', authCookie)
    expect(res.status).toBe(200)
  })
})
