import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import type { Artifact } from '../lib/api'
import { buildMarkedOptions, utf8FromBase64 } from '../lib/markdownRenderer'
import { renderPikchr } from '../lib/pikchrRenderer'
import { renderMdArt } from '../lib/mdart/renderer'
import { MdArtView } from './MdArtView'
import { LinkPreviewCard } from './LinkPreviewCard'
import type { LinkPreviewCardHandle } from './LinkPreviewCard'

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

    Promise.all([
      import('vega-embed'),
      import('vega-lite'),
    ]).then(([{ default: vegaEmbed }, vegaLite]) => {
      if (cancelled || !containerRef.current) return
      let vlSpec: Record<string, unknown>
      try {
        vlSpec = JSON.parse(content) as Record<string, unknown>
      } catch {
        setError('Invalid JSON: could not parse chart spec')
        setLoading(false)
        return
      }

      // Vega-Lite 6 bug: `bind: 'scales'` on a layer spec emits pan/zoom
      // signals (grid_tuple, hover_tuple, etc.) once per layer instead of
      // once per view, producing "Duplicate signal name" runtime errors.
      // Fix: compile VL → Vega ourselves, deduplicate top-level signals by
      // keeping the first occurrence of each name, then render as Vega.
      let vegaSpec: Record<string, unknown>
      try {
        const compiled = vegaLite.compile(vlSpec as unknown as Parameters<typeof vegaLite.compile>[0])
        vegaSpec = compiled.spec as Record<string, unknown>
        if (Array.isArray(vegaSpec.signals)) {
          const seen = new Set<string>()
          vegaSpec.signals = (vegaSpec.signals as Array<{ name?: string }>).filter(s => {
            if (!s.name) return true
            if (seen.has(s.name)) return false
            seen.add(s.name)
            return true
          })
        }
      } catch (compileErr) {
        // If VL compilation fails fall back to passing the raw spec to vega-embed
        vegaSpec = { ...vlSpec, autosize: vlSpec['autosize'] ?? { type: 'fit', contains: 'padding' } }
      }

      if (!('$schema' in vegaSpec && String(vegaSpec.$schema).includes('vega-lite'))) {
        // Already Vega or fallback path — inject autosize
        vegaSpec = { ...vegaSpec, autosize: vegaSpec['autosize'] ?? { type: 'fit', contains: 'padding' } }
      } else {
        vegaSpec = { ...vegaSpec, autosize: vegaSpec['autosize'] ?? { type: 'fit', contains: 'padding' } }
      }

      vegaEmbed(containerRef.current, vegaSpec as Parameters<typeof vegaEmbed>[1], {
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

function ReportView({ content, projectId }: { content: string; projectId: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef    = useRef<HTMLDivElement>(null)
  const marginRef     = useRef<HTMLElement>(null)
  const connectorSvgRef = useRef<SVGSVGElement>(null)
  const pikchrCache = useRef<Map<string, string>>(new Map())
  const mdartCache = useRef<Map<string, string>>(new Map())
  const [layout, setLayout]           = useState<'compact' | 'narrow' | 'rich'>('compact')
  const [wrapperWidth, setWrapperWidth] = useState(0)
  const [hoveredLink, setHoveredLink] = useState<{ href: string; title: string; anchorRect: DOMRect } | null>(null)
  const hoveredLinkRef = useRef(hoveredLink)   // readable inside stale event-listener closures
  const hoverTimer     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cardRef        = useRef<LinkPreviewCardHandle>(null)

  // Keep ref in sync so stale event-listener closures can read current value.
  useEffect(() => { hoveredLinkRef.current = hoveredLink }, [hoveredLink])

  // Track container width — gate layout features on available space
  // compact: <480px  narrow: 480–680px  rich: >680px
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setWrapperWidth(width)
      if (width >= 680) setLayout('rich')
      else if (width >= 480) setLayout('narrow')
      else setLayout('compact')
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Encode artifact: link targets before marked parses them — artifact names
  // can contain spaces and special chars which break markdown URL parsing.
  // [text](artifact:My Report) → [text](artifact:My%20Report)
  const preprocessed = content.replace(
    /\[([^\]]+)\]\(artifact:([^)]+)\)/g,
    (_, text: string, name: string) => `[${text}](artifact:${encodeURIComponent(name.trim())})`
  )

  const html = DOMPurify.sanitize(
    marked.parse(preprocessed, { renderer: buildMarkedOptions(null).renderer, breaks: true }) as string,
    {
      ADD_ATTR: ['style', 'data-src', 'data-type'],
      // Allow the artifact: URI scheme for inter-artifact links in addition to
      // the standard DOMPurify allowlist (http/https/mailto/ftp/tel/etc).
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|artifact):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    }
  )

  // Hydrate pikchr placeholders after render (same pattern as MessageBubble)
  useEffect(() => {
    if (!containerRef.current) return
    const placeholders = containerRef.current.querySelectorAll<HTMLDivElement>(
      '.pikchr-placeholder:not(.pikchr-rendered)'
    )
    placeholders.forEach((el) => {
      const src = decodeURIComponent(el.getAttribute('data-src') ?? '')
      if (!src) return
      const cached = pikchrCache.current.get(src)
      if (cached) {
        el.innerHTML = cached
        el.classList.add('pikchr-rendered')
        return
      }
      renderPikchr(src).then((svg) => {
        pikchrCache.current.set(src, svg)
        if (el.isConnected && !el.classList.contains('pikchr-rendered')) {
          el.innerHTML = svg
          el.classList.add('pikchr-rendered')
        }
      }).catch((err: unknown) => {
        el.classList.add('pikchr-error')
        el.textContent = `Pikchr error: ${String(err)}`
      })
    })
  })

  // Hydrate mdart placeholders (synchronous — same pattern as MessageBubble)
  useEffect(() => {
    if (!containerRef.current) return
    const placeholders = containerRef.current.querySelectorAll<HTMLDivElement>(
      '.mdart-placeholder:not(.mdart-rendered)'
    )
    placeholders.forEach((el) => {
      const encoded = el.dataset.src ?? ''
      if (!encoded) return
      const hintType = el.dataset.type || undefined
      const cacheKey = encoded + '|' + (hintType ?? '')
      const cached = mdartCache.current.get(cacheKey)
      if (cached) {
        el.innerHTML = cached
        el.classList.add('mdart-rendered')
        return
      }
      try {
        const raw = utf8FromBase64(encoded)
        const svg = renderMdArt(raw, hintType)
        mdartCache.current.set(cacheKey, svg)
        if (el.isConnected && !el.classList.contains('mdart-rendered')) {
          el.innerHTML = svg
          el.classList.add('mdart-rendered')
        }
      } catch (e) {
        el.classList.add('mdart-error')
        el.textContent = `MdArt error: ${String(e)}`
      }
    })
  })

  // Link interaction → show LinkPreviewCard for artifact: links and external URLs.
  // Uses event delegation on the prose container (links are inside dangerouslySetInnerHTML).
  //
  // Desktop: hover (mouseover/mouseout) with a short delay.
  // Mobile:  tap (click) toggles the preview; artifact: links never navigate.
  //          External links still navigate (browser handles them) but also
  //          show a brief preview on first tap if the card isn't already open.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function getPreviewHref(target: EventTarget | null): string | null {
      const link = (target as Element | null)?.closest<HTMLAnchorElement>('a[href]')
      if (!link) return null
      const href = link.getAttribute('href') ?? ''
      if (!href || href.startsWith('#')) return null
      return href
    }

    function onMouseOver(e: MouseEvent) {
      const href = getPreviewHref(e.target)
      if (!href) return
      // Cancel any pending fade-on-mouseout — we're moving to another link.
      clearTimeout(hoverTimer.current!)
      const link = (e.target as Element).closest<HTMLAnchorElement>('a[href]')!
      const title = link.getAttribute('title') ?? ''
      // Capture rect synchronously during the event — before any React batching,
      // re-renders, or iOS viewport adjustments can shift the element.
      const anchorRect = link.getBoundingClientRect()
      // If a card is already visible, swap instantly — no hover delay needed.
      // Delay only on fresh hover to avoid flicker from quick mouse-overs.
      const delay = hoveredLinkRef.current ? 0 : 280
      hoverTimer.current = setTimeout(() => {
        setHoveredLink({ href, title, anchorRect })
      }, delay)
    }

    function onMouseOut(e: MouseEvent) {
      if (!getPreviewHref(e.target)) return
      clearTimeout(hoverTimer.current!)
      // Delay fade slightly: if the cursor moves to another link, onMouseOver
      // fires within ~50ms and cancels this timer before it fires (no fade shown,
      // clean swap). Only triggers if cursor truly leaves all link areas.
      hoverTimer.current = setTimeout(() => {
        cardRef.current?.fadeNow()
      }, 100)
    }

    function onClick(e: MouseEvent) {
      const link = (e.target as Element).closest<HTMLAnchorElement>('a[href]')
      if (!link) return
      const href = link.getAttribute('href') ?? ''
      if (!href || href.startsWith('#')) return

      // Both artifact: and external links use the same tap logic:
      // first tap shows the preview card; navigation (for external links) goes
      // through the "Open →" button inside the card.
      e.preventDefault()
      const title = link.getAttribute('title') ?? ''
      const anchorRect = link.getBoundingClientRect()
      setHoveredLink(prev =>
        prev?.href === href ? null : { href, title, anchorRect }
      )
    }

    container.addEventListener('mouseover', onMouseOver)
    container.addEventListener('mouseout', onMouseOut)
    container.addEventListener('click', onClick)
    return () => {
      clearTimeout(hoverTimer.current!)
      container.removeEventListener('mouseover', onMouseOver)
      container.removeEventListener('mouseout', onMouseOut)
      container.removeEventListener('click', onClick)
    }
  }, [])

  // Lift footnotes into the sidenote margin when layout allows.
  // Runs after html changes or layout mode switches.
  useEffect(() => {
    const container = containerRef.current
    const margin = marginRef.current
    if (!container || !margin) return

    // Clear previously placed sidenotes
    margin.innerHTML = ''

    const fnSection = container.querySelector<HTMLElement>('section[data-footnotes]')

    if (layout === 'compact' || !fnSection) {
      // Clear connector lines and restore footnote section
      const svg = connectorSvgRef.current
      if (svg) { while (svg.firstChild) svg.removeChild(svg.firstChild) }
      if (fnSection) fnSection.style.display = ''
      return
    }

    // Hide original footnote section — content moves to margin column
    fnSection.style.display = 'none'

    const fnItems = fnSection.querySelectorAll<HTMLElement>('li[id^="footnote-"]')
    const marginRect = margin.getBoundingClientRect()

    const placed:  HTMLElement[] = []
    const anchors: HTMLElement[] = []

    fnItems.forEach((li, index) => {
      const refAnchor = container.querySelector<HTMLElement>(`a[href="#${li.id}"]`)
      if (!refAnchor) return

      const idealTop = Math.max(0, refAnchor.getBoundingClientRect().top - marginRect.top)

      // Clone content, remove back-reference arrow
      const clone = li.cloneNode(true) as HTMLElement
      clone.querySelector('[data-footnote-backref]')?.remove()

      const note = document.createElement('div')
      note.className = 'sidenote'
      note.style.top = `${idealTop}px`
      note.dataset.idealTop = String(idealTop)

      // Prepend the footnote number
      const marker = document.createElement('span')
      marker.className = 'sidenote-marker'
      marker.textContent = String(index + 1)
      note.appendChild(marker)
      note.insertAdjacentHTML('beforeend', clone.innerHTML)

      margin.appendChild(note)
      placed.push(note)
      anchors.push(refAnchor)
    })

    // Second pass: nudge overlapping notes and draw SVG connector lines.
    // rAF gives the browser one frame to compute offsetHeight and rects.
    let rafId: number
    rafId = requestAnimationFrame(() => {
      const GAP = 6
      let minTop = 0
      const svg = connectorSvgRef.current
      const wrapperRect = wrapperRef.current?.getBoundingClientRect()

      // Clear previous connectors
      if (svg) { while (svg.firstChild) svg.removeChild(svg.firstChild) }

      const STROKE      = '#707070'
      const W           = '0.75'
      const BASE_X_OFFSET = 5   // px left of margin border for the first connector
      const STEP          = 5   // additional px left per stacked connector
      let   connectorIdx  = 0   // counts nudged notes to stagger x positions

      placed.forEach((note, i) => {
        const ideal  = parseFloat(note.dataset.idealTop ?? '0')
        const actual = Math.max(ideal, minTop)
        note.style.top = `${actual}px`
        note.style.removeProperty('--nudge')

        const nudge = actual - ideal
        if (nudge > 0 && svg && wrapperRect) {
          const anchor     = anchors[i]
          const anchorRect = anchor.getBoundingClientRect()
          const mRect      = margin.getBoundingClientRect()

          // Stagger each connector's x so verticals sit side by side, not on top of each other.
          // Notes with earlier anchors (lower index) sit closest to the margin.
          const x2 = mRect.left - wrapperRect.left - BASE_X_OFFSET - connectorIdx * STEP

          // Place the horizontal arm in the interline gap below the text line
          // containing the anchor. Walk up to the nearest block ancestor to read
          // its line-height, then find the bottom of the line at the anchor's y.
          let yH: number
          {
            let block: Element | null = anchor.parentElement
            while (block) {
              const disp = window.getComputedStyle(block).display
              if (!disp.startsWith('inline') && disp !== 'contents') break
              block = block.parentElement
            }
            if (block) {
              const st   = window.getComputedStyle(block)
              const lhRaw = st.lineHeight
              const lineH = lhRaw === 'normal'
                ? parseFloat(st.fontSize) * 1.5
                : parseFloat(lhRaw)
              const blockTop = block.getBoundingClientRect().top
              const lineIdx  = Math.floor((anchorRect.top - blockTop) / lineH)
              yH = blockTop + (lineIdx + 1) * lineH - wrapperRect.top + 2
            } else {
              yH = anchorRect.bottom - wrapperRect.top + 4
            }
          }
          const x1            = anchorRect.left + anchorRect.width / 2 - wrapperRect.left
          const yAnchorBottom = anchorRect.bottom - wrapperRect.top
          // Entry tick ends 3px short of the sidenote's left content edge (small breathing gap)
          const xSidenoteEdge = mRect.left - wrapperRect.left - 3
          // Vertical target: midpoint of the sidenote marker number
          const markerEl   = note.firstElementChild as HTMLElement | null
          const markerRect = markerEl?.getBoundingClientRect()
          const yV         = markerRect
            ? (markerRect.top + markerRect.bottom) / 2 - wrapperRect.top
            : mRect.top - wrapperRect.top + actual + 9

          // Single continuous path with rounded corners so the dash pattern
          // flows smoothly around each bend without restarting.
          // dy1: direction of segment 1 (anchor → yH), always downward
          // dy3: direction of segment 3 (yH → yV), down (+1) or up (-1)
          const dy1 = yH >= yAnchorBottom ? 1 : -1
          const dy3 = yV >= yH           ? 1 : -1
          const r = Math.min(
            4,
            Math.abs(yH - yAnchorBottom) / 2,
            Math.abs(x1 - x2) / 2,
            Math.abs(yV - yH) / 2,
            Math.abs(xSidenoteEdge - x2) / 2,
          )
          const d = [
            `M ${x1},${yAnchorBottom}`,
            `L ${x1},${yH - dy1 * r}`,
            `Q ${x1},${yH} ${x1 - r},${yH}`,
            `L ${x2 + r},${yH}`,
            `Q ${x2},${yH} ${x2},${yH + dy3 * r}`,
            `L ${x2},${yV - dy3 * r}`,
            `Q ${x2},${yV} ${x2 + r},${yV}`,
            `L ${xSidenoteEdge},${yV}`,
          ].join(' ')
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
          path.setAttribute('d', d)
          path.setAttribute('stroke', STROKE)
          path.setAttribute('stroke-width', W)
          path.setAttribute('stroke-dasharray', '2 3')
          path.setAttribute('fill', 'none')
          svg!.appendChild(path)

          connectorIdx++
        }

        minTop = actual + note.offsetHeight + GAP
      })
    })

    return () => cancelAnimationFrame(rafId)
  }, [layout, html, wrapperWidth])

  return (
    <>
      <div ref={wrapperRef} className="report-layout" data-layout={layout}>
        <div className="report-main">
          <div
            ref={containerRef}
            className="prose prose-invert prose-sm max-w-none px-1"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
        <aside ref={marginRef} className="report-margin" aria-label="Sidenotes" />
        <svg ref={connectorSvgRef} className="sidenote-connectors" aria-hidden="true" />
      </div>
      {hoveredLink && (
        <>
          {/* Backdrop for tap-outside dismiss on touch devices.
              pointer-events disabled on hover-capable (desktop) devices so it
              doesn't intercept mouseover, text selection, or link hover effects —
              the card's fade-on-mouseout handles desktop dismiss already. */}
          <div
            className="link-preview-backdrop"
            onClick={() => setHoveredLink(null)}
          />
          <LinkPreviewCard
            key={hoveredLink.href}
            ref={cardRef}
            href={hoveredLink.href}
            title={hoveredLink.title}
            anchorRect={hoveredLink.anchorRect}
            projectId={projectId}
            onDismiss={() => setHoveredLink(null)}
            onMouseEnter={() => clearTimeout(hoverTimer.current!)}
          />
        </>
      )}
    </>
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

// ── Pikchr renderer ──────────────────────────────────────────────────────────

function PikchrView({ content }: { content: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSvg(null)
    setError(null)
    renderPikchr(content).then((result) => {
      if (result.trimStart().startsWith('<svg')) {
        setSvg(result)
      } else {
        setError(result)
      }
    }).catch((err: unknown) => {
      setError(String(err))
    })
  }, [content])

  if (error) {
    return (
      <div className="pikchr-error">
        <pre>{error}</pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#333] border-t-[#666]" />
      </div>
    )
  }

  return (
    <div
      className="pikchr-placeholder pikchr-rendered overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

// ── HTML renderer ─────────────────────────────────────────────────────────────

function HtmlView({ content }: { content: string }) {
  const [height, setHeight] = useState(500)
  const [expanded, setExpanded] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Listen for resize messages from the iframe so it can report its own height
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.data && typeof ev.data === 'object' && ev.data.__stewardResize) {
        setHeight(Math.min(Math.max(ev.data.height as number, 100), 2000))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Inject a tiny auto-resize helper into the srcdoc so the iframe can report
  // its content height back to the parent via postMessage.
  const autoResizeScript = `<script>
(function(){
  function report(){
    var h=document.documentElement.scrollHeight||document.body.scrollHeight;
    parent.postMessage({__stewardResize:true,height:h},'*');
  }
  window.addEventListener('load',report);
  new MutationObserver(report).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true});
})();
<\/script>`

  // Inject the helper right before </body> or </html>, or append if neither found.
  function injectHelper(html: string): string {
    const lower = html.toLowerCase()
    const bodyClose = lower.lastIndexOf('</body>')
    const htmlClose = lower.lastIndexOf('</html>')
    const insertAt = bodyClose !== -1 ? bodyClose : htmlClose !== -1 ? htmlClose : html.length
    return html.slice(0, insertAt) + autoResizeScript + html.slice(insertAt)
  }

  const srcdoc = injectHelper(content)
  const displayHeight = expanded ? Math.max(height, 500) : Math.min(height, 500)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => setReloadKey(k => k + 1)}
          className="text-[11px] text-[#555] hover:text-[#aaa] py-0.5 px-2 rounded border border-[#2a2a2a] hover:border-[#444]"
          title="Force reload preview"
        >
          ↺ reload
        </button>
      </div>
      <iframe
        key={reloadKey}
        srcDoc={srcdoc}
        sandbox="allow-scripts allow-downloads"
        className="w-full rounded-md border border-[#2a2a2a] bg-white"
        style={{ height: displayHeight, transition: 'height 0.15s ease' }}
        title="HTML artifact"
      />
      {height > 500 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="self-center text-[11px] text-[#555] hover:text-[#aaa] py-0.5 px-2 rounded border border-[#2a2a2a] hover:border-[#444]"
        >
          {expanded ? '↑ collapse' : `↓ expand (${height}px)`}
        </button>
      )}
    </div>
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
      {artifact.type === 'report' && <ReportView content={content} projectId={artifact.project_id} />}
      {artifact.type === 'data' && <DataView content={content} />}
      {artifact.type === 'code' && <CodeView content={content} artifact={artifact} />}
      {artifact.type === 'pikchr'   && <PikchrView content={content} />}
      {artifact.type === 'html'     && <HtmlView content={content} />}
      {artifact.type === 'mdart' && <MdArtView content={content} />}
    </div>
  )
}
