/**
 * Browser eval relay — lets Claude execute JS in the live browser context.
 *
 * Flow:
 *   Claude → POST /api/eval { code }
 *     → server broadcasts SSE event: eval { id, code } to all connected browsers
 *     → server long-polls (up to 10 s) waiting for the browser to POST back
 *   Browser receives SSE, executes code, POST /api/eval/:id/result { result?, error? }
 *     → server resolves the pending promise and responds to Claude with the result
 *
 * Auth:
 *   POST /api/eval        — API key (Authorization: Bearer) OR session cookie
 *                           so Claude can call it directly without a login ceremony
 *   POST /api/eval/:id/result — open (the UUID is the secret; only the browser that
 *                           received the broadcast knows it)
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import { broadcastEvent } from '../lib/connections.js'
import { getValidSessionToken } from '../auth/session.js'

const router = Router()

// ── Pending eval store ────────────────────────────────────────────────────────

type EvalResult = { result?: string; error?: string }
type PendingEval = { resolve: (r: EvalResult) => void; timer: ReturnType<typeof setTimeout> }

const pending = new Map<string, PendingEval>()
const EVAL_TIMEOUT_MS = 10_000

// ── Auth helper ───────────────────────────────────────────────────────────────

/** Accept a valid session cookie OR the server API key in Authorization: Bearer. */
function requireApiKeyOrSession(req: Request, res: Response, next: NextFunction): void {
  const token = getValidSessionToken(req.cookies ?? {})
  if (token) { next(); return }

  const apiKey = process.env.API_KEY
  if (apiKey && req.headers.authorization === `Bearer ${apiKey}`) { next(); return }

  res.status(401).json({ error: 'Unauthorized' })
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/eval
 * Body: { code: string }
 * Response: { result?: string, error?: string }
 *
 * Broadcasts the code to all connected browsers and waits up to 10 s for a reply.
 * If no browser is connected (or none responds in time) returns { error: "timeout…" }.
 */
router.post('/', requireApiKeyOrSession, (req: Request, res: Response) => {
  const { code } = req.body as { code?: string }
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'code is required' })
    return
  }

  const id = randomUUID()

  const resultPromise = new Promise<EvalResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({ error: 'timeout: no browser responded within 10 s' })
    }, EVAL_TIMEOUT_MS)
    pending.set(id, { resolve, timer })
  })

  broadcastEvent('eval', { id, code })

  resultPromise.then((evalResult) => {
    if (!res.writableEnded) res.json(evalResult)
  })
})

/**
 * POST /api/eval/:id/result
 * Body: { result?: string, error?: string }
 * Called by the browser after executing the code.
 */
router.post('/:id/result', (req: Request, res: Response) => {
  const id = req.params['id'] as string
  const body = req.body as EvalResult

  const entry = pending.get(id)
  if (!entry) {
    // Already timed out or duplicate reply — ignore gracefully
    res.json({ ok: false, reason: 'unknown or already resolved' })
    return
  }

  clearTimeout(entry.timer)
  pending.delete(id)
  entry.resolve(body)
  res.json({ ok: true })
})

export default router
