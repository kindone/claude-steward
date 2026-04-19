import { Router } from 'express'
import { getState } from '../claude/rateLimits.js'

const router = Router()

// GET /api/rate-limits
// Returns cached rate limit state from the last probe, or null if no API key
// is configured. The probe runs every 60s; clients should poll at the same cadence.
router.get('/', (_req, res) => {
  res.json(getState())
})

export default router
