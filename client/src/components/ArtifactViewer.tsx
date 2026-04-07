import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import type { Artifact } from '../lib/api'

interface Props {
  artifact: Artifact
  content: string
  className?: string
}

// ── Chart renderer ────────────────────────────────────────────────────────────

function ChartView({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    let view: { finalize(): void } | null = null
    let cancelled = false

    setLoading(true)
    setError(null)

    import('vega-embed').then(({ default: vegaEmbed }) => {
      if (cancelled || !containerRef.current) return
      let spec: unknown
      try {
        spec = JSON.parse(content)
      } catch {
        setError('Invalid JSON: could not parse chart spec')
        setLoading(false)
        return
      }
      // Ensure the full chart (including axes) fits the container width,
      // not just the plot area. Override only if the spec doesn't set autosize.
      const s = spec as Record<string, unknown>
      const mergedSpec = { ...s, autosize: s['autosize'] ?? { type: 'fit', contains: 'padding' } }
      vegaEmbed(containerRef.current, mergedSpec as Parameters<typeof vegaEmbed>[1], {
        actions: false,
        renderer: 'svg',
      }).then((result) => {
        if (cancelled) { result.view.finalize(); return }
        view = result.view
        setLoading(false)
      }).catch((err: unknown) => {
        if (cancelled) return
        setError(`Chart render failed: ${err instanceof Error ? err.message : String(err)}`)
        setLoading(false)
      })
    }).catch((err: unknown) => {
      if (cancelled) return
      setError(`Failed to load chart library: ${err instanceof Error ? err.message : String(err)}`)
      setLoading(false)
    })

    return () => {
      cancelled = true
      view?.finalize()
    }
  }, [content])

  if (error) {
    return (
      <div className="p-4 text-sm text-red-400 bg-red-500/10 rounded-md border border-red-500/20">
        {error}
      </div>
    )
  }

  return (
    <div className="relative min-h-[200px]" style={{ overflowX: 'auto' }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#333] border-t-[#666]" />
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', minWidth: 0 }} />
    </div>
  )
}

// ── Report renderer ───────────────────────────────────────────────────────────

function ReportView({ content }: { content: string }) {
  const html = DOMPurify.sanitize(
    marked.parse(content, { breaks: true }) as string,
    { ADD_ATTR: ['style'] }
  )
  return (
    <div
      className="prose prose-invert prose-sm max-w-none px-1"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// ── Data renderer ─────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc' | null
type SortState = { col: number; dir: SortDir }

function DataView({ content }: { content: string }) {
  const [sort, setSort] = useState<SortState>({ col: -1, dir: null })

  const { headers, rows } = parseData(content)

  function toggleSort(col: number) {
    setSort((prev) => {
      if (prev.col !== col) return { col, dir: 'asc' }
      if (prev.dir === 'asc') return { col, dir: 'desc' }
      return { col: -1, dir: null }
    })
  }

  const sortedRows = sort.dir == null ? rows : [...rows].sort((a, b) => {
    const av = a[sort.col] ?? ''
    const bv = b[sort.col] ?? ''
    const an = parseFloat(av)
    const bn = parseFloat(bv)
    const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv)
    return sort.dir === 'asc' ? cmp : -cmp
  })

  if (headers.length === 0) {
    return <p className="text-[12px] text-[#444] italic px-1">No data to display.</p>
  }

  return (
    <div className="overflow-auto max-h-[500px] rounded-md border border-[#2a2a2a]">
      <table className="text-[12px] w-full border-collapse">
        <thead className="sticky top-0 bg-[#1a1a1a]">
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                onClick={() => toggleSort(i)}
                className="text-left px-3 py-2 text-[#aaa] font-semibold cursor-pointer select-none border-b border-[#2a2a2a] hover:text-[#e8e8e8] whitespace-nowrap"
              >
                {h}
                {sort.col === i && (
                  <span className="ml-1 text-[#666]">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, ri) => (
            <tr key={ri} className="border-b border-[#1e1e1e] hover:bg-[#1a1a1a]">
              {headers.map((_, ci) => (
                <td key={ci} className="px-3 py-1.5 text-[#ccc] whitespace-nowrap">
                  {row[ci] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function parseData(content: string): { headers: string[]; rows: string[][] } {
  const trimmed = content.trim()
  if (!trimmed) return { headers: [], rows: [] }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    // JSON — flatten top-level array of objects
    try {
      const parsed = JSON.parse(trimmed)
      const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
      const headers = Array.from(
        new Set(items.flatMap((item) => (item && typeof item === 'object' ? Object.keys(item as object) : [])))
      )
      const rows = items.map((item) =>
        headers.map((h) => {
          if (!item || typeof item !== 'object') return ''
          const v = (item as Record<string, unknown>)[h]
          return v == null ? '' : String(v)
        })
      )
      return { headers, rows }
    } catch {
      return { headers: ['Raw'], rows: [[trimmed]] }
    }
  }

  // CSV
  const lines = trimmed.split('\n').filter((l) => l.trim())
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = parseCsvRow(lines[0])
  const rows = lines.slice(1).map(parseCsvRow)
  return { headers, rows }
}

function parseCsvRow(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuote = !inQuote; continue }
    if (ch === ',' && !inQuote) { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  out.push(cur.trim())
  return out
}

// ── Code renderer ─────────────────────────────────────────────────────────────

function CodeView({ content, artifact }: { content: string; artifact: Artifact }) {
  const codeRef = useRef<HTMLElement>(null)

  let lang = ''
  try {
    if (artifact.metadata) {
      const meta = JSON.parse(artifact.metadata) as { language?: string }
      lang = meta.language ?? ''
    }
  } catch { /* ignore */ }

  useLayoutEffect(() => {
    const el = codeRef.current
    if (!el) return
    el.removeAttribute('data-highlighted')
    if (lang && hljs.getLanguage(lang)) {
      hljs.highlight(content, { language: lang }).value
      el.innerHTML = hljs.highlight(content, { language: lang }).value
    } else {
      hljs.highlightElement(el)
    }
  })

  return (
    <pre className="rounded-md bg-[#0d0d0d] border border-[#2a2a2a] overflow-auto text-[12px]">
      <code ref={codeRef} className={lang ? `language-${lang}` : ''}>{content}</code>
    </pre>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ArtifactViewer({ artifact, content, className }: Props) {
  if (!content) {
    return (
      <div className={`flex items-center justify-center py-12 text-[#444] text-sm italic ${className ?? ''}`}>
        This artifact has no content yet.
      </div>
    )
  }

  return (
    <div className={className ?? ''}>
      {artifact.type === 'chart' && <ChartView content={content} />}
      {artifact.type === 'report' && <ReportView content={content} />}
      {artifact.type === 'data' && <DataView content={content} />}
      {artifact.type === 'code' && <CodeView content={content} artifact={artifact} />}
    </div>
  )
}
