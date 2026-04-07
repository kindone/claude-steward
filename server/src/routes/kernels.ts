import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { projectQueries } from '../db/index.js'
import { getProjectKernelManager } from '../kernels/manager.js'
import type { Language } from '../kernels/types.js'

// mergeParams: true exposes the parent router's :projectId at runtime,
// but TypeScript doesn't know about it — cast req.params to get the value.
type KernelParams = { projectId: string; name: string }

const router = Router({ mergeParams: true })

const VALID_LANGUAGES = new Set<Language>(['python', 'node', 'bash', 'cpp'])

function isLanguage(s: unknown): s is Language {
  return typeof s === 'string' && VALID_LANGUAGES.has(s as Language)
}

/** GET /api/projects/:projectId/kernels — list live kernels for this project */
router.get('/', (req, res) => {
  const project = projectQueries.findById((req.params as KernelParams).projectId)
  if (!project) { res.status(404).json({ error: 'Project not found' }); return }

  const mgr = getProjectKernelManager()
  res.json(mgr.listForProject(project.id))
})

/** POST /api/projects/:projectId/kernels — ensure a named kernel exists */
router.post('/', (req, res) => {
  const project = projectQueries.findById((req.params as KernelParams).projectId)
  if (!project) { res.status(404).json({ error: 'Project not found' }); return }

  const { name, language } = req.body as { name?: unknown; language?: unknown }
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' }); return
  }
  if (!isLanguage(language)) {
    res.status(400).json({ error: `language must be one of: ${[...VALID_LANGUAGES].join(', ')}` }); return
  }

  const mgr = getProjectKernelManager()
  const nk = mgr.getOrCreate(project.id, project.path, name.trim(), language)
  res.json({
    name: nk.name,
    language: nk.language,
    projectId: nk.projectId,
    alive: nk.kernel.alive,
    pid: nk.kernel.pid,
    createdAt: nk.createdAt,
    lastUsedAt: nk.lastUsedAt,
  })
})

/**
 * POST /api/projects/:projectId/kernels/:name/run
 * Body: { language, code }
 * Response: SSE stream of output/done events
 */
router.post('/:name/run', (req, res) => {
  const project = projectQueries.findById((req.params as KernelParams).projectId)
  if (!project) { res.status(404).json({ error: 'Project not found' }); return }

  const kernelName = (req.params as KernelParams).name
  const { language, code } = req.body as { language?: unknown; code?: unknown }

  if (!isLanguage(language)) {
    res.status(400).json({ error: `language must be one of: ${[...VALID_LANGUAGES].join(', ')}` }); return
  }
  if (typeof code !== 'string') {
    res.status(400).json({ error: 'code must be a string' }); return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const cellId = randomUUID()
  const ac = new AbortController()
  const startedAt = Date.now()

  res.on('close', () => ac.abort())

  // Keepalive ping every 20s for nginx proxy
  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n')
  }, 20_000)

  function send(event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const mgr = getProjectKernelManager()

  mgr.run(project.id, project.path, kernelName, language, {
    cellId,
    source: code,
    onLine: (line) => send('output', { text: line }),
    onCompile: (ok, output) => send('compile', { ok, output }),
    signal: ac.signal,
  }).then(() => {
    send('done', { exitCode: 0, durationMs: Date.now() - startedAt })
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    send('done', { exitCode: 1, durationMs: Date.now() - startedAt, error: msg })
  }).finally(() => {
    clearInterval(keepalive)
    res.end()
  })
})

/** POST /api/projects/:projectId/kernels/:name/reset — reset kernel state */
router.post('/:name/reset', async (req, res) => {
  const project = projectQueries.findById((req.params as KernelParams).projectId)
  if (!project) { res.status(404).json({ error: 'Project not found' }); return }

  const { language } = req.body as { language?: unknown }
  if (!isLanguage(language)) {
    res.status(400).json({ error: `language must be one of: ${[...VALID_LANGUAGES].join(', ')}` }); return
  }

  const mgr = getProjectKernelManager()
  await mgr.reset(project.id, (req.params as KernelParams).name, language)
  res.json({ ok: true })
})

/** DELETE /api/projects/:projectId/kernels/:name — kill a named kernel */
router.delete('/:name', (req, res) => {
  const project = projectQueries.findById((req.params as KernelParams).projectId)
  if (!project) { res.status(404).json({ error: 'Project not found' }); return }

  const { language } = req.body as { language?: unknown }
  if (!isLanguage(language)) {
    res.status(400).json({ error: `language must be one of: ${[...VALID_LANGUAGES].join(', ')}` }); return
  }

  const mgr = getProjectKernelManager()
  mgr.kill(project.id, (req.params as KernelParams).name, language)
  res.json({ ok: true })
})

export default router
