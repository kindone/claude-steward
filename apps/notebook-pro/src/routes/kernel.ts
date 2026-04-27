import { Router } from 'express'
import { getCell, type Language } from '../db.js'
import { getKernelManager } from '../kernels/manager.js'
import { sendSseEvent, broadcastEvent } from '../sse.js'

export const kernelRouter = Router()

const VALID_LANGS: Language[] = ['python', 'node', 'bash', 'cpp']

// ── Typed output protocol ─────────────────────────────────────────────────────
// Cells can emit structured output using the sentinel format:
//   NBOUT:<kind>:<base64-encoded-payload>
// Valid kinds: vega, html, image, table.
// Any line starting with '{' that is a Vega-Lite spec is also auto-detected.

const NBOUT_PREFIX = 'NBOUT:'
const VALID_RICH_KINDS = new Set(['vega', 'html', 'image', 'table'])

function handleLine(res: import('express').Response, cellId: string, line: string): void {
  // 1. Explicit NBOUT sentinel
  if (line.startsWith(NBOUT_PREFIX)) {
    const rest = line.slice(NBOUT_PREFIX.length)
    const colonIdx = rest.indexOf(':')
    if (colonIdx !== -1) {
      const kind = rest.slice(0, colonIdx)
      const payload = rest.slice(colonIdx + 1)
      if (VALID_RICH_KINDS.has(kind) && payload.length > 0) {
        sendSseEvent(res, 'rich_output', { kind, payload })
        broadcastEvent('cell:run-event', { cellId, type: 'rich_output', kind, payload })
        return
      }
    }
  }
  // 2. Auto-detect Vega-Lite JSON (so print(json.dumps(spec)) just works)
  if (line.startsWith('{')) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>
      if (typeof obj['$schema'] === 'string' &&
          obj['$schema'].startsWith('https://vega.github.io/')) {
        const payload = Buffer.from(line).toString('base64')
        sendSseEvent(res, 'rich_output', { kind: 'vega', payload })
        broadcastEvent('cell:run-event', { cellId, type: 'rich_output', kind: 'vega', payload })
        return
      }
    } catch { /* not JSON — fall through */ }
  }
  // 3. Plain text (existing behaviour)
  sendSseEvent(res, 'output', { line })
  broadcastEvent('cell:run-event', { cellId, type: 'output', line })
}

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

  broadcastEvent('cell:run-event', { cellId: cell.id, type: 'started' })

  try {
    await getKernelManager().run(cell.notebook_id, cell.language as Language, {
      cellId: cell.id,
      source: cell.source,
      signal: ac.signal,
      onLine: (line) => handleLine(res, cell.id, line),
      onCompile: (ok, output) => {
        sendSseEvent(res, 'compile', { ok, output })
        broadcastEvent('cell:run-event', { cellId: cell.id, type: 'compile', ok, output })
      },
    })
    sendSseEvent(res, 'done', { cellId: cell.id })
    broadcastEvent('cell:run-event', { cellId: cell.id, type: 'done' })
  } catch (err) {
    if (!ac.signal.aborted) {
      const message = err instanceof Error ? err.message : String(err)
      sendSseEvent(res, 'error', { message })
      broadcastEvent('cell:run-event', { cellId: cell.id, type: 'error', message })
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
