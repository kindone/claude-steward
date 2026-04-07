import { Router } from 'express'
import { getCell, type Language } from '../db.js'
import { getKernelManager } from '../kernels/manager.js'
import { sendSseEvent } from '../sse.js'

export const kernelRouter = Router()

const VALID_LANGS: Language[] = ['python', 'node', 'bash', 'cpp']

function sseHeaders(res: import('express').Response): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
}

// POST /api/kernel/run/:cellId
kernelRouter.post('/kernel/run/:cellId', async (req, res) => {
  const cell = getCell(req.params.cellId)
  if (!cell) { res.status(404).json({ error: 'Cell not found' }); return }
  if (cell.type === 'markdown') { res.status(400).json({ error: 'Cannot run markdown cells' }); return }

  sseHeaders(res)

  const ac = new AbortController()
  res.on('close', () => ac.abort())

  try {
    await getKernelManager().run(cell.notebook_id, cell.language as Language, {
      cellId: cell.id,
      source: cell.source,
      signal: ac.signal,
      onLine: (line) => sendSseEvent(res, 'output', { line }),
      onCompile: (ok, output) => sendSseEvent(res, 'compile', { ok, output }),
    })
    sendSseEvent(res, 'done', { cellId: cell.id })
  } catch (err) {
    if (!ac.signal.aborted) {
      sendSseEvent(res, 'error', { message: err instanceof Error ? err.message : String(err) })
    }
  } finally {
    if (!res.writableEnded) res.end()
  }
})

// GET /api/notebooks/:notebookId/kernel/status
kernelRouter.get('/notebooks/:notebookId/kernel/status', (req, res) => {
  res.json(getKernelManager().status(req.params.notebookId))
})

// POST /api/notebooks/:notebookId/kernel/restart/:lang
kernelRouter.post('/notebooks/:notebookId/kernel/restart/:lang', async (req, res) => {
  const lang = req.params.lang as Language
  if (!VALID_LANGS.includes(lang)) { res.status(400).json({ error: 'Invalid language' }); return }

  await getKernelManager().restart(req.params.notebookId, lang)
  res.json({ ok: true, language: lang })
})

// POST /api/notebooks/:notebookId/kernel/reset/:lang
kernelRouter.post('/notebooks/:notebookId/kernel/reset/:lang', async (req, res) => {
  const lang = req.params.lang as Language
  if (!VALID_LANGS.includes(lang)) { res.status(400).json({ error: 'Invalid language' }); return }

  await getKernelManager().resetState(req.params.notebookId, lang)
  res.json({ ok: true, language: lang })
})

export function shutdownKernels(): void {
  try { getKernelManager().shutdown() } catch { /* not initialised */ }
}
