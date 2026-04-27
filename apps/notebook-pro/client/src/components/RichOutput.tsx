import { useEffect, useRef, useState } from 'react'
import embed from 'vega-embed'
import type { RichOutputKind } from '../types'

interface Props {
  kind: RichOutputKind
  payload: string  // base64-encoded payload
}

function decodePayload(payload: string): string {
  try { return atob(payload) } catch { return '' }
}

export function RichOutput({ kind, payload }: Props) {
  switch (kind) {
    case 'vega':  return <VegaOutput payload={payload} />
    case 'html':  return <HtmlOutput payload={payload} />
    case 'image': return <ImageOutput payload={payload} />
    case 'table': return <TableOutput payload={payload} />
    default:      return null
  }
}

// ── Vega-Lite chart ───────────────────────────────────────────────────────────
// vega-embed is a DOM library — imperative API, not JSX-friendly.
// Pattern: useRef for the container div, useEffect to call embed(), cleanup finalizes.
// Static import (not dynamic) — dynamic import('vega-embed') fails in WebKit.

function VegaOutput({ payload }: { payload: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let finalize: (() => void) | null = null

    const decoded = decodePayload(payload)
    if (!decoded) { setError('[vega] empty payload'); return }

    let spec: unknown
    try { spec = JSON.parse(decoded) }
    catch { setError('[vega] invalid JSON spec'); return }

    embed(container, spec as Parameters<typeof embed>[1], {
      actions: false,   // hide the "…" export menu for clean embedding
      theme: 'dark',
    }).then(result => {
      if (cancelled) { result.finalize(); return }
      finalize = () => result.finalize()
    }).catch(err => {
      if (!cancelled) setError(`[vega] ${String(err)}`)
    })

    return () => {
      cancelled = true
      finalize?.()
    }
  }, [payload])

  if (error) return <pre className="text-red-400 text-xs">{error}</pre>

  return (
    <div
      ref={containerRef}
      className="vega-output w-full rounded overflow-x-auto"
      style={{ minHeight: 100 }}
    />
  )
}

// ── HTML iframe ───────────────────────────────────────────────────────────────
// sandbox="allow-scripts" only — no allow-same-origin so the iframe
// cannot reach the parent page's DOM or cookies.

function HtmlOutput({ payload }: { payload: string }) {
  const html = decodePayload(payload)
  return (
    <iframe
      srcDoc={html}
      sandbox="allow-scripts"
      className="w-full rounded border border-[var(--color-border)] bg-white"
      style={{ minHeight: 200, colorScheme: 'light' }}
      title="Cell HTML output"
    />
  )
}

// ── Inline image ──────────────────────────────────────────────────────────────
// SVG is routed to HtmlOutput by display.py; here we handle raster images.

function ImageOutput({ payload }: { payload: string }) {
  return (
    <img
      src={`data:image/png;base64,${payload}`}
      alt="Cell image output"
      className="max-w-full rounded"
    />
  )
}

// ── Sortable table ────────────────────────────────────────────────────────────

function TableOutput({ payload }: { payload: string }) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortAsc, setSortAsc] = useState(true)

  const decoded = decodePayload(payload)
  let rows: Record<string, unknown>[] = []
  try {
    const parsed = JSON.parse(decoded)
    rows = Array.isArray(parsed) ? parsed : []
  } catch {
    return <pre className="text-red-400 text-xs">[table] invalid JSON</pre>
  }

  if (rows.length === 0) {
    return <div className="text-xs text-[var(--color-muted)]">(empty table)</div>
  }

  const columns = Object.keys(rows[0])

  const sorted = sortKey
    ? [...rows].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey]
        const cmp = av === bv ? 0 : av! < bv! ? -1 : 1
        return sortAsc ? cmp : -cmp
      })
    : rows

  const toggleSort = (col: string) => {
    if (sortKey === col) setSortAsc(a => !a)
    else { setSortKey(col); setSortAsc(true) }
  }

  return (
    <div className="overflow-x-auto rounded border border-[var(--color-border)]">
      <table className="text-xs w-full border-collapse">
        <thead>
          <tr className="bg-black/30">
            {columns.map(col => (
              <th
                key={col}
                onClick={() => toggleSort(col)}
                className="px-3 py-1.5 text-left text-[var(--color-muted)] cursor-pointer select-none hover:text-white border-b border-[var(--color-border)] whitespace-nowrap"
              >
                {col}
                <span className="ml-1 opacity-50">
                  {sortKey === col ? (sortAsc ? '▲' : '▼') : '⇅'}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? '' : 'bg-white/5'}>
              {columns.map(col => (
                <td
                  key={col}
                  className="px-3 py-1 text-gray-300 border-b border-[var(--color-border)]/50 whitespace-nowrap"
                >
                  {String(row[col] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-1 text-[10px] text-[var(--color-muted)] border-t border-[var(--color-border)]">
        {rows.length} row{rows.length !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
