/**
 * Mini-app API routes.
 *
 * Mounted at /api in app.ts so that both:
 *   /api/projects/:id/apps   (project-scoped CRUD)
 *   /api/apps/:configId/...  (per-config actions)
 * are handled by this single router.
 */

import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { projectQueries, appConfigQueries, appSlotQueries } from '../db/index.js'
import { appsClient } from '../apps/client.js'

const router = Router()

const MAX_APP_CONFIGS = 10

// ── GET /api/apps/slots — all slot states (before :configId routes!) ──────────

router.get('/apps/slots', (_req, res) => {
  const slots = appSlotQueries.listAll()
  res.json({ slots })
})

// ── GET /api/projects/:id/apps — list configs for a project ──────────────────

router.get('/projects/:id/apps', (req, res) => {
  const project = projectQueries.findById(req.params['id']!)
  if (!project) { res.status(404).json({ error: 'Project not found' }); return }

  const configs = appConfigQueries.listByProject(project.id)
  const slots = appSlotQueries.listAll()

  const result = configs.map((cfg) => {
    const slot = slots.find((s) => s.config_id === cfg.id)
    return { ...cfg, slot: slot?.slot ?? null, status: slot?.status ?? 'stopped', pid: slot?.pid ?? null }
  })

  res.json({ apps: result })
})

// ── POST /api/projects/:id/apps — create a config ────────────────────────────

router.post('/projects/:id/apps', (req, res) => {
  const project = projectQueries.findById(req.params['id']!)
  if (!project) { res.status(404).json({ error: 'Project not found' }); return }

  if (appConfigQueries.countAll() >= MAX_APP_CONFIGS) {
    res.status(409).json({ error: `Maximum of ${MAX_APP_CONFIGS} app configs reached` })
    return
  }

  const { name, type = 'mkdocs', command_template, work_dir } = req.body as Record<string, string>

  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return }
  if (!command_template?.trim()) { res.status(400).json({ error: 'command_template is required' }); return }
  if (!command_template.includes('{port}')) {
    res.status(400).json({ error: 'command_template must contain {port} placeholder' })
    return
  }
  if (!work_dir?.trim()) { res.status(400).json({ error: 'work_dir is required' }); return }
  if (!fs.existsSync(work_dir)) { res.status(400).json({ error: 'work_dir does not exist' }); return }

  const config = appConfigQueries.create(randomUUID(), project.id, name.trim(), type, command_template.trim(), work_dir.trim())
  res.status(201).json({ app: config })
})

// ── PATCH /api/apps/:configId — update a config ───────────────────────────────

router.patch('/apps/:configId', (req, res) => {
  const config = appConfigQueries.findById(req.params['configId']!)
  if (!config) { res.status(404).json({ error: 'App config not found' }); return }

  const slot = appSlotQueries.findByConfigId(config.id)
  if (slot && (slot.status === 'running' || slot.status === 'starting')) {
    res.status(409).json({ error: 'Cannot edit a running app — stop it first' })
    return
  }

  const { name, command_template, work_dir } = req.body as Record<string, string>

  if (command_template !== undefined && !command_template.includes('{port}')) {
    res.status(400).json({ error: 'command_template must contain {port} placeholder' })
    return
  }
  if (work_dir !== undefined && !fs.existsSync(work_dir)) {
    res.status(400).json({ error: 'work_dir does not exist' })
    return
  }

  const updated = appConfigQueries.update(config.id, { name, command_template, work_dir })
  res.json({ app: updated })
})

// ── DELETE /api/apps/:configId — delete a config ──────────────────────────────

router.delete('/apps/:configId', (req, res) => {
  const config = appConfigQueries.findById(req.params['configId']!)
  if (!config) { res.status(404).json({ error: 'App config not found' }); return }

  const slot = appSlotQueries.findByConfigId(config.id)
  if (slot && (slot.status === 'running' || slot.status === 'starting')) {
    res.status(409).json({ error: 'Cannot delete a running app — stop it first' })
    return
  }

  appConfigQueries.delete(config.id)
  res.json({ ok: true })
})

// ── POST /api/apps/:configId/start ────────────────────────────────────────────

router.post('/apps/:configId/start', async (req, res) => {
  const config = appConfigQueries.findById(req.params['configId']!)
  if (!config) { res.status(404).json({ error: 'App config not found' }); return }

  // Already running?
  const existing = appSlotQueries.findByConfigId(config.id)
  if (existing && (existing.status === 'running' || existing.status === 'starting')) {
    res.status(409).json({ error: 'App is already running', slot: existing.slot })
    return
  }

  if (!appsClient.isConnected()) {
    res.status(503).json({ error: 'Apps sidecar is not available' })
    return
  }

  const freeSlot = appSlotQueries.findFreeSlot()
  if (!freeSlot) {
    res.status(503).json({ error: 'No free slots available (all 10 are in use)' })
    return
  }

  const port = 4000 + freeSlot.slot
  const command = config.command_template.replace(/\{port\}/g, String(port))

  appSlotQueries.assign(freeSlot.slot, config.id)

  try {
    const started = await appsClient.start(config.id, port, command, config.work_dir)
    appSlotQueries.markRunning(freeSlot.slot, started.pid)
    res.json({ slot: freeSlot.slot, port, pid: started.pid, url: `https://app${freeSlot.slot}.steward.jradoo.com` })
  } catch (err) {
    appSlotQueries.markError(freeSlot.slot, String(err))
    res.status(502).json({ error: `Failed to start app: ${String(err)}` })
  }
})

// ── POST /api/apps/:configId/stop ─────────────────────────────────────────────

router.post('/apps/:configId/stop', async (req, res) => {
  const config = appConfigQueries.findById(req.params['configId']!)
  if (!config) { res.status(404).json({ error: 'App config not found' }); return }

  const slot = appSlotQueries.findByConfigId(config.id)
  if (!slot || slot.status === 'stopped') {
    res.json({ ok: true, message: 'App was already stopped' })
    return
  }

  if (appsClient.isConnected()) {
    try {
      await appsClient.stop(config.id)
    } catch (err) {
      console.warn('[apps] stop command failed:', err)
      // Fall through and mark stopped anyway — process may already be dead
    }
  }

  appSlotQueries.markStopped(slot.slot)
  res.json({ ok: true })
})

export default router
