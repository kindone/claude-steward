import { useState, useEffect } from 'react'

type RateLimitState = {
  requestsLimit: number | null
  requestsRemaining: number | null
  requestsReset: string | null
  tokensLimit: number | null
  tokensRemaining: number | null
  tokensReset: string | null
  probedAt: number
}

function fmt(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

function Bar({ value, limit }: { value: number | null; limit: number | null }) {
  if (value === null || limit === null || limit === 0) return null
  const pct = Math.max(0, Math.min(100, (value / limit) * 100))
  const color = pct > 50 ? 'bg-green-500' : pct > 20 ? 'bg-amber-400' : 'bg-red-500'
  return (
    <div className="h-1 w-full rounded-full bg-app-border overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function RateLimitWidget() {
  const [state, setState] = useState<RateLimitState | null>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch('/api/rate-limits', { credentials: 'include' })
        if (res.ok && !cancelled) {
          const data = await res.json() as RateLimitState | null
          setState(data)
        }
      } catch {
        // silently ignore — server may be restarting
      }
    }

    poll()
    const id = setInterval(poll, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (!state) return null

  return (
    <div className="px-2 py-1.5 border-t border-app-border">
      <div className="text-[10px] font-medium text-app-text-7 uppercase tracking-wide mb-1">Rate Limits</div>
      <div className="flex flex-col gap-1.5">
        <div>
          <div className="flex justify-between text-[10px] text-app-text-6 mb-0.5">
            <span>Requests</span>
            <span>{fmt(state.requestsRemaining)} / {fmt(state.requestsLimit)}</span>
          </div>
          <Bar value={state.requestsRemaining} limit={state.requestsLimit} />
        </div>
        <div>
          <div className="flex justify-between text-[10px] text-app-text-6 mb-0.5">
            <span>Tokens</span>
            <span>{fmt(state.tokensRemaining)} / {fmt(state.tokensLimit)}</span>
          </div>
          <Bar value={state.tokensRemaining} limit={state.tokensLimit} />
        </div>
      </div>
    </div>
  )
}
