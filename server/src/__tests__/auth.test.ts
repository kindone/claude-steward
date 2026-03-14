import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'

const app = createApp()

describe('auth middleware', () => {
  it('rejects requests with no Authorization header', async () => {
    const res = await request(app).get('/api/sessions')
    expect(res.status).toBe(401)
  })

  it('rejects requests with wrong Bearer token', async () => {
    const res = await request(app)
      .get('/api/sessions')
      .set('Authorization', 'Bearer wrong-key')
    expect(res.status).toBe(403)
  })

  it('rejects malformed Authorization header', async () => {
    const res = await request(app)
      .get('/api/sessions')
      .set('Authorization', 'test-key')  // missing "Bearer " prefix
    expect(res.status).toBe(401)
  })

  it('passes through with correct Bearer token', async () => {
    const res = await request(app)
      .get('/api/sessions')
      .set('Authorization', 'Bearer test-key')
    expect(res.status).toBe(200)
  })
})
