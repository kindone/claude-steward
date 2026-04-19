/**
 * Rate limit probe — makes a minimal Anthropic API call once on startup
 * and every 60 seconds thereafter to read the ratelimit response headers.
 *
 * Requires ANTHROPIC_API_KEY in the environment. If not set, getState()
 * returns null and no probing occurs.
 */

import Anthropic from '@anthropic-ai/sdk'

export type RateLimitState = {
  requestsLimit: number | null
  requestsRemaining: number | null
  requestsReset: string | null
  tokensLimit: number | null
  tokensRemaining: number | null
  tokensReset: string | null
  probedAt: number // Date.now()
}

let cached: RateLimitState | null = null
let timer: ReturnType<typeof setInterval> | null = null

function parseIntHeader(headers: Headers, name: string): number | null {
  const val = headers.get(name)
  if (!val) return null
  const n = parseInt(val, 10)
  return isNaN(n) ? null : n
}

async function probe(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return

  try {
    const client = new Anthropic({ apiKey })
    const { response } = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: '0' }],
    }).withResponse()

    const h = response.headers
    cached = {
      requestsLimit:     parseIntHeader(h, 'anthropic-ratelimit-requests-limit'),
      requestsRemaining: parseIntHeader(h, 'anthropic-ratelimit-requests-remaining'),
      requestsReset:     h.get('anthropic-ratelimit-requests-reset'),
      tokensLimit:       parseIntHeader(h, 'anthropic-ratelimit-tokens-limit'),
      tokensRemaining:   parseIntHeader(h, 'anthropic-ratelimit-tokens-remaining'),
      tokensReset:       h.get('anthropic-ratelimit-tokens-reset'),
      probedAt:          Date.now(),
    }
    console.log('[rate-limits] probed —', cached.requestsRemaining, 'requests remaining')
  } catch (err) {
    console.warn('[rate-limits] probe failed:', (err as Error).message)
  }
}

export function getState(): RateLimitState | null {
  return cached
}

export function startProbe(intervalMs = 60_000): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[rate-limits] ANTHROPIC_API_KEY not set — rate limit probe disabled')
    return
  }
  // Fire immediately, then repeat
  probe()
  timer = setInterval(probe, intervalMs)
}

export function stopProbe(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
