import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import cron from 'node-cron'
import { scheduleQueries, sessionQueries, pushSubscriptionQueries } from '../db/index.js'
import { nextFireAt } from '../lib/scheduler.js'
import { sendToSession } from '../lib/sendToSession.js'
import { notifyWatchers, notifySubscribers } from '../lib/sessionWatchers.js'
import { notifySession, notifyAll } from '../lib/pushNotifications.js'
import { setLastPushTarget } from '../lib/pushNotifications.js'
import { broadcastEvent, hasActiveClients } from '../lib/connections.js'

const router = Router()

// GET /api/schedules?sessionId=X
router.get('/', (req, res) => {
  const { sessionId } = req.query as { sessionId?: string }
  const schedules = sessionId
    ? scheduleQueries.listBySession(sessionId)
    : scheduleQueries.list()
  res.json(schedules)
})

// POST /api/schedules
router.post('/', (req, res) => {
  const { sessionId, cron: cronExpr, prompt, enabled } = req.body as {
    sessionId?: string
    cron?: string
    prompt?: string
    enabled?: boolean
  }

  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId is required' })
    return
  }
  if (!cronExpr || typeof cronExpr !== 'string' || !cron.validate(cronExpr)) {
    res.status(400).json({ error: 'cron must be a valid cron expression (e.g. "0 9 * * 1-5")' })
    return
  }
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ error: 'prompt must be a non-empty string' })
    return
  }
  if (!sessionQueries.findById(sessionId)) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  const nextRun = nextFireAt(cronExpr)
  const schedule = scheduleQueries.create(uuidv4(), sessionId, cronExpr, prompt.trim(), nextRun)
  if (enabled === false) {
    scheduleQueries.update(schedule.id, { enabled: false })
  }
  res.status(201).json(schedule)
})

// PATCH /api/schedules/:id
router.patch('/:id', (req, res) => {
  const schedule = scheduleQueries.findById(req.params.id)
  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found' })
    return
  }

  const { cron: cronExpr, prompt, enabled } = req.body as {
    cron?: string
    prompt?: string
    enabled?: boolean
  }

  if (cronExpr !== undefined) {
    if (!cron.validate(cronExpr)) {
      res.status(400).json({ error: 'cron must be a valid cron expression' })
      return
    }
  }
  if (prompt !== undefined && (!prompt || !prompt.trim())) {
    res.status(400).json({ error: 'prompt must be a non-empty string' })
    return
  }

  const nextRun = cronExpr ? nextFireAt(cronExpr) : undefined
  const updated = scheduleQueries.update(schedule.id, {
    cron: cronExpr,
    prompt: prompt?.trim(),
    enabled,
    nextRunAt: nextRun,
  })
  res.json(updated)
})

// DELETE /api/schedules/:id
router.delete('/:id', (req, res) => {
  const schedule = scheduleQueries.findById(req.params.id)
  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found' })
    return
  }
  scheduleQueries.delete(req.params.id)
  res.status(204).end()
})

// POST /api/schedules/:id/run — manual trigger for testing
router.post('/:id/run', async (req, res) => {
  const schedule = scheduleQueries.findById(req.params.id)
  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found' })
    return
  }

  const session = sessionQueries.findById(schedule.session_id)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  res.json({ ok: true, message: 'Schedule triggered' })

  try {
    const result = await sendToSession(schedule.session_id, schedule.prompt, { source: 'scheduler' })
    const notified = notifyWatchers(schedule.session_id)
    notifySubscribers(schedule.session_id)
    if (notified === 0 && result.content) {
      const preview = result.content.replace(/\s+/g, ' ').trim()
      const payload = {
        title: session.title === 'New Chat' ? 'Claude replied' : session.title,
        body: preview.slice(0, 80) + (preview.length > 80 ? '…' : ''),
        url: `/?session=${schedule.session_id}${session.project_id ? `&project=${session.project_id}` : ''}`,
      }
      const pushTarget = { sessionId: schedule.session_id, projectId: session.project_id ?? null, title: session.title ?? 'New message', body: payload.body }
      if (hasActiveClients()) {
        // User is in the app — show in-app toast, skip push
        broadcastEvent('pushTarget', pushTarget)
      } else {
        // User left the app — send push notification + store target for visibilitychange poll
        const sessionSubs = pushSubscriptionQueries.listBySession(schedule.session_id)
        if (sessionSubs.length > 0) {
          void notifySession(schedule.session_id, payload)
        } else {
          void notifyAll(payload)
        }
        setLastPushTarget(pushTarget.sessionId, pushTarget.projectId)
      }
    }
  } catch (err) {
    console.error(`[schedules] manual run failed for schedule ${schedule.id}:`, err)
  }
})

export default router
