import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import type { Cell as CellType, Language, OutputLine, CompileResult } from '../types'
import { streamKernelRun, updateCell, deleteCell } from '../api'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import mermaid from 'mermaid'

mermaid.initialize({ startOnLoad: false, theme: 'dark' })

const LANG_LABELS: Record<Language, string> = {
  python: 'Python',
  node: 'Node.js',
  bash: 'Bash',
  cpp: 'C++',
}

const LANG_COLORS: Record<Language, string> = {
  python: 'text-blue-400',
  node: 'text-green-400',
  bash: 'text-yellow-400',
  cpp: 'text-orange-400',
}

interface Props {
  cell: CellType
  onUpdate: (cell: CellType) => void
  onDelete: (id: string) => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  isRunningByAI?: boolean
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderInline(text: string): string {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-black/30 px-1 rounded text-xs font-mono">$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-[var(--color-accent)] underline" target="_blank">$1</a>')
}

let mermaidCounter = 0

function renderMarkdown(text: string): string {
  const parts: string[] = []
  const fenceRe = /^```(\w*)\n([\s\S]*?)^```/gm
  let last = 0

  for (const m of text.matchAll(fenceRe)) {
    if (m.index! > last) {
      parts.push(renderPlain(text.slice(last, m.index!)))
    }
    const lang = m[1].toLowerCase()
    const code = m[2]
    if (lang === 'mermaid') {
      const id = `nb-mermaid-${++mermaidCounter}`
      parts.push(`<div class="nb-mermaid my-3" id="${id}" data-code="${escHtml(code.trim())}"></div>`)
    } else {
      parts.push(`<pre class="bg-black/30 rounded p-3 my-2 overflow-x-auto text-xs font-mono whitespace-pre">${escHtml(code)}</pre>`)
    }
    last = m.index! + m[0].length
  }

  if (last < text.length) parts.push(renderPlain(text.slice(last)))
  return parts.join('')
}

function renderPlain(text: string): string {
  return text
    .replace(/^### (.+)$/gm, (_, t) => `<h3 class="text-base font-semibold mt-3 mb-1">${renderInline(t)}</h3>`)
    .replace(/^## (.+)$/gm,  (_, t) => `<h2 class="text-lg font-semibold mt-4 mb-1">${renderInline(t)}</h2>`)
    .replace(/^# (.+)$/gm,   (_, t) => `<h1 class="text-xl font-bold mt-4 mb-2">${renderInline(t)}</h1>`)
    .replace(/^- (.+)$/gm,   (_, t) => `<li class="ml-4 list-disc">${renderInline(t)}</li>`)
    .replace(/^(\d+)\. (.+)$/gm, (_, _n, t) => `<li class="ml-4 list-decimal">${renderInline(t)}</li>`)
    .split(/\n\n+/)
    .map(para => {
      if (/^<[h1-6li]/.test(para.trim())) return para
      return `<p class="mb-2">${para.trim().split('\n').map(renderInline).join('<br/>')}</p>`
    })
    .join('\n')
}

const CROSSFADE_MS = 200

/**
 * Two-layer crossfade hook.
 *
 * Uses CSS grid (both layers get `grid-area: 1/1`) to stack them in the same
 * cell — the container height is the natural max of both layers, no ResizeObserver
 * needed. Opacity is managed purely through Tailwind classes so React never fights
 * with direct DOM style manipulation.
 *
 * The flip (old→invisible, new→visible) is scheduled via rAF so it always runs
 * after React has committed the new HTML to the back layer.
 */
function useCrossfadePanel(html: string, enabled: boolean) {
  const [front, setFront] = useState<0 | 1>(0)
  // htmls tracks the string content per layer (used by useRenderMermaid as a dep
  // to detect content changes). We do NOT pass these to dangerouslySetInnerHTML —
  // see useLayoutEffect below for why.
  const [htmls, setHtmls] = useState<[string, string]>([html, ''])
  const ref0 = useRef<HTMLDivElement>(null)
  const ref1 = useRef<HTMLDivElement>(null)
  // Always-current copy of `front` — avoids stale closure in the effect
  const frontRef = useRef<0 | 1>(0)
  const rafRef = useRef<number | null>(null)
  // Incremented on every flip so useRenderMermaid can re-run for the new front layer.
  const [flipVersion, setFlipVersion] = useState(0)

  // Set innerHTML directly rather than via dangerouslySetInnerHTML.
  //
  // dangerouslySetInnerHTML creates a new {__html} object on every render (it's
  // always an inline literal). React compares props by reference, so it sees a
  // change every render and calls `el.innerHTML = html` — even when the string
  // didn't change. That wipes any mermaid SVGs that were asynchronously written
  // by mermaid.render(). Direct DOM writes in useLayoutEffect fire only when
  // htmls actually changes, so React never touches the layer divs' content.
  useLayoutEffect(() => {
    if (ref0.current) ref0.current.innerHTML = htmls[0]
    if (ref1.current) ref1.current.innerHTML = htmls[1]
  }, [htmls]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Cancel any pending flip so rapid updates collapse into one crossfade
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

    const f = frontRef.current
    const back = (1 - f) as 0 | 1

    if (!enabled) {
      // Panel not visible: keep front layer content in sync, no animation
      setHtmls(h => { const n = [...h] as [string, string]; n[f] = html; return n })
      return
    }

    // Stage new content in the back layer (opacity 0 → user can't see it yet)
    setHtmls(h => { const n = [...h] as [string, string]; n[back] = html; return n })

    // After React commits the new HTML, flip front/back — CSS handles the crossfade
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      frontRef.current = back
      setFront(back)
      setFlipVersion(v => v + 1)
    })
  }, [html, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
  }, [])

  const layerStyle = (i: 0 | 1): React.CSSProperties => ({
    gridArea: '1 / 1',
    opacity: front === i ? 1 : 0,
    pointerEvents: front === i ? 'auto' : 'none',
    transition: `opacity ${CROSSFADE_MS}ms ease-in-out`,
  })

  return {
    containerStyle: { display: 'grid' } as React.CSSProperties,
    layer0: { ref: ref0, style: layerStyle(0) },
    layer1: { ref: ref1, style: layerStyle(1) },
    frontRef: front === 0 ? ref0 : ref1,
    frontHtml: htmls[front],
    flipVersion,
  }
}

// Shared mermaid rendering hook — runs after the given HTML is committed to containerRef.
// flipVersion is incremented by useCrossfadePanel after each layer flip so this hook
// re-runs targeting the new front layer (which holds fresh placeholders with no SVG yet).
function useRenderMermaid(
  containerRef: React.RefObject<HTMLDivElement | null>,
  html: string,
  enabled: boolean,
  flipVersion: number,
) {
  useEffect(() => {
    if (!enabled || !containerRef.current) return
    const nodes = containerRef.current.querySelectorAll<HTMLElement>('.nb-mermaid')
    if (!nodes.length) return
    nodes.forEach(async (el) => {
      const code = el.dataset.code ?? ''
      const renderId = (el.id || `nb-mermaid-${++mermaidCounter}`) + '-svg'
      try {
        const { svg } = await mermaid.render(renderId, code)
        el.innerHTML = svg
      } catch (err) {
        el.innerHTML = `<pre class="text-red-400 text-xs p-2 whitespace-pre-wrap">${escHtml(String(err))}</pre>`
      } finally {
        // Mermaid creates a hidden wrapper in body with id="d{renderId}" (and sometimes
        // id="{renderId}" too). The parentElement guard ensures we never remove the SVG
        // that was successfully placed inside el (its parent is el, not body).
        for (const id of [renderId, `d${renderId}`]) {
          const tmp = document.getElementById(id)
          if (tmp?.parentElement === document.body) tmp.remove()
        }
      }
    })
  }, [enabled, html, flipVersion]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function Cell({ cell, onUpdate, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown, isRunningByAI }: Props) {
  const [source, setSource] = useState(cell.source)
  const [isDirty, setIsDirty] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [outputs, setOutputs] = useState<OutputLine[]>([])
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [wrapLines, setWrapLines] = useState(false)
  const [mdPreview, setMdPreview] = useState(cell.type === 'markdown')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [livePreview, setLivePreview] = useState(cell.source)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const fsRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync external updates (file watcher / AI edits)
  useEffect(() => {
    if (cell.source !== source && !isDirty) {
      setSource(cell.source)
      setLivePreview(cell.source)
    }
  }, [cell.source])

  // Cleanup debounce timer on unmount
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  // Body overflow lock while fullscreen
  useEffect(() => {
    document.body.classList.toggle('nb-fullscreen', isFullscreen)
    return () => document.body.classList.remove('nb-fullscreen')
  }, [isFullscreen])

  // Focus overlay on open so Esc key is captured
  useEffect(() => {
    if (isFullscreen) fsRef.current?.focus()
  }, [isFullscreen])

  // Run All: imperative run trigger from parent
  useEffect(() => {
    const handler = (e: Event) => {
      const { cellId, onDone } = (e as CustomEvent<{ cellId: string; onDone: () => void }>).detail
      if (cellId !== cell.id) return
      if (cell.type === 'markdown') { onDone(); return }

      setIsRunning(true)
      setOutputs([])
      setCompileResult(null)

      const ac = new AbortController()
      abortRef.current = ac

      streamKernelRun(
        cell.id,
        (line) => setOutputs(prev => [...prev, { text: line }]),
        (ok, output) => setCompileResult({ ok, output }),
        () => { setIsRunning(false); abortRef.current = null; onDone() },
        (msg) => {
          setOutputs(prev => [...prev, { text: msg, isError: true }])
          setIsRunning(false)
          abortRef.current = null
          onDone()
        },
        ac.signal,
      )
    }
    window.addEventListener('notebook:run-cell', handler)
    return () => window.removeEventListener('notebook:run-cell', handler)
  }, [cell.id, cell.type])

  // Auto-resize normal textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [source, mdPreview])

  const handleSourceChange = (val: string) => {
    setSource(val)
    setIsDirty(true)
    // Debounce live preview for fullscreen right panel
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setLivePreview(val), 400)
  }

  const handleSave = useCallback(async () => {
    if (!isDirty) return
    const updated = await updateCell(cell.id, { source })
    onUpdate(updated)
    setIsDirty(false)
  }, [cell.id, source, isDirty, onUpdate])

  const handleRun = async () => {
    if (isRunning) {
      abortRef.current?.abort()
      return
    }

    if (isDirty) await handleSave()

    setIsRunning(true)
    setOutputs([])
    setCompileResult(null)

    const ac = new AbortController()
    abortRef.current = ac

    streamKernelRun(
      cell.id,
      (line) => setOutputs(prev => [...prev, { text: line }]),
      (ok, output) => setCompileResult({ ok, output }),
      () => { setIsRunning(false); abortRef.current = null },
      (msg) => {
        setOutputs(prev => [...prev, { text: msg, isError: true }])
        setIsRunning(false)
        abortRef.current = null
      },
      ac.signal,
    )
  }

  // Uses e.currentTarget so it works for both normal and fullscreen textareas
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newVal = source.substring(0, start) + '  ' + source.substring(end)
      setSource(newVal)
      setIsDirty(true)
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + 2 }, 0)
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleRun()
    }
  }

  const isMarkdown = cell.type === 'markdown'
  const highlight = isRunningByAI ? 'ring-1 ring-purple-500' : ''

  // Memoised so renderMarkdown (which increments mermaidCounter) only runs when source
  // actually changes — not on every re-render. Must be declared before any useEffect
  // that references them in its deps array (TDZ would throw otherwise).
  const normalHtml = useMemo(() => isMarkdown
    ? (source ? renderMarkdown(source) : '<span class="text-[var(--color-muted)] text-xs">Empty — click to edit</span>')
    : '',
  [isMarkdown, source])

  const fsHtml = useMemo(() => isMarkdown
    ? (livePreview ? renderMarkdown(livePreview) : '<span class="text-[var(--color-muted)] text-xs">Start typing…</span>')
    : '',
  [isMarkdown, livePreview])

  // Two-layer crossfade panels
  const normalCf = useCrossfadePanel(normalHtml, isMarkdown && mdPreview && !isFullscreen)
  const fsCf    = useCrossfadePanel(fsHtml,     isMarkdown && isFullscreen)

  // Mermaid rendering into whichever layer is currently front.
  // flipVersion ensures we re-run after each crossfade flip (new front layer has fresh placeholders).
  useRenderMermaid(normalCf.frontRef, normalCf.frontHtml, isMarkdown && mdPreview && !isFullscreen, normalCf.flipVersion)
  useRenderMermaid(fsCf.frontRef,    fsCf.frontHtml,    isMarkdown && isFullscreen,               fsCf.flipVersion)

  return (
    <>
      {/* ── Normal cell card ── */}
      <div className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden ${highlight}`}>
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-black/20">

          {/* Reorder buttons */}
          <div className="flex flex-col -my-0.5 mr-0.5">
            <button
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="text-[var(--color-muted)] hover:text-white disabled:opacity-20 disabled:cursor-not-allowed leading-none text-[10px] px-0.5"
              title="Move up"
            >▲</button>
            <button
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className="text-[var(--color-muted)] hover:text-white disabled:opacity-20 disabled:cursor-not-allowed leading-none text-[10px] px-0.5"
              title="Move down"
            >▼</button>
          </div>

          {isMarkdown ? (
            <span className="text-xs font-medium text-purple-400">Markdown</span>
          ) : (
            <span className={`text-xs font-medium ${LANG_COLORS[cell.language]}`}>
              {LANG_LABELS[cell.language]}
            </span>
          )}
          <span className="text-xs text-[var(--color-muted)]">#{cell.position}</span>
          {isDirty && <span className="text-xs text-yellow-500">●</span>}
          {isRunningByAI && <span className="text-xs text-purple-400 animate-pulse">AI running…</span>}

          <div className="ml-auto flex items-center gap-1">
            {isMarkdown && (
              <button
                onClick={() => setIsFullscreen(true)}
                className="text-xs px-1.5 py-0.5 rounded text-[var(--color-muted)] hover:text-white hover:bg-white/10"
                title="Fullscreen side-by-side editor"
              >⛶</button>
            )}
            {isMarkdown && (
              <button
                onClick={() => { if (isDirty) handleSave(); setMdPreview(!mdPreview) }}
                className="text-xs px-2 py-0.5 rounded text-[var(--color-muted)] hover:text-white hover:bg-white/10"
              >
                {mdPreview ? 'Edit' : 'Preview'}
              </button>
            )}
            {isDirty && (
              <button
                onClick={handleSave}
                className="text-xs px-2 py-0.5 rounded text-[var(--color-muted)] hover:text-white hover:bg-white/10"
              >
                Save
              </button>
            )}
            {!isMarkdown && (
              <button
                onClick={() => setWrapLines(w => !w)}
                className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                  wrapLines
                    ? 'text-white bg-white/15'
                    : 'text-[var(--color-muted)] hover:text-white hover:bg-white/10'
                }`}
                title={wrapLines ? 'Line wrap on — click to disable' : 'Line wrap off — click to enable'}
              >↵</button>
            )}
            {!isMarkdown && (
              <button
                onClick={handleRun}
                className={`text-xs px-2.5 py-0.5 rounded font-medium transition-colors ${
                  isRunning
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30'
                }`}
              >
                {isRunning ? '■ Stop' : '▶ Run'}
              </button>
            )}
            <button
              onClick={() => setShowDelete(!showDelete)}
              className="text-xs px-1.5 py-0.5 rounded text-[var(--color-muted)] hover:text-red-400 hover:bg-red-500/10"
            >
              ✕
            </button>
          </div>
        </div>

        {showDelete && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border-b border-[var(--color-border)]">
            <span className="text-xs text-red-400">Delete this cell?</span>
            <button onClick={() => onDelete(cell.id)} className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30">Delete</button>
            <button onClick={() => setShowDelete(false)} className="text-xs px-2 py-0.5 rounded text-[var(--color-muted)] hover:bg-white/10">Cancel</button>
          </div>
        )}

        {/* Markdown preview — two-layer crossfade */}
        {isMarkdown && mdPreview ? (
          <div
            className="min-h-[60px] cursor-text"
            style={normalCf.containerStyle}
            onClick={() => setMdPreview(false)}
          >
            {([normalCf.layer0, normalCf.layer1] as const).map((layer, i) => (
              <div
                key={i}
                ref={layer.ref}
                className="p-3 text-sm text-[var(--color-text)] leading-relaxed prose-invert"
                style={layer.style}
              />
            ))}
          </div>
        ) : isMarkdown ? (
          <textarea
            ref={textareaRef}
            value={source}
            onChange={(e) => handleSourceChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => { handleSave(); setMdPreview(true) }}
            spellCheck={false}
            placeholder="# Markdown content…"
            className="w-full bg-transparent text-[var(--color-text)] p-3 resize-none outline-none leading-relaxed min-h-[80px]"
            style={{ height: 'auto' }}
          />
        ) : (
          <CodeMirrorEditor
            value={source}
            language={cell.language}
            onChange={handleSourceChange}
            onRun={handleRun}
            onBlur={handleSave}
            wrapLines={wrapLines}
          />
        )}

        {/* C++ compile result */}
        {compileResult && (
          <div className={`px-3 py-2 border-t border-[var(--color-border)] text-xs ${
            compileResult.ok ? 'text-green-400 bg-green-500/5' : 'text-red-400 bg-red-500/5'
          }`}>
            <div className="font-medium mb-1">{compileResult.ok ? '✓ Compiled' : '✗ Compile error'}</div>
            {compileResult.output && (
              <pre className="whitespace-pre-wrap opacity-80">{compileResult.output}</pre>
            )}
          </div>
        )}

        {/* Output */}
        {outputs.length > 0 && (
          <div className="border-t border-[var(--color-border)] bg-black/30 p-3">
            <pre className="text-xs leading-relaxed whitespace-pre-wrap">
              {outputs.map((o, i) => (
                <span key={i} className={o.isError ? 'text-red-400' : 'text-gray-300'}>
                  {o.text}{'\n'}
                </span>
              ))}
            </pre>
          </div>
        )}

        {isRunning && outputs.length === 0 && (
          <div className="border-t border-[var(--color-border)] px-3 py-2">
            <span className="text-xs text-[var(--color-muted)] animate-pulse">Running…</span>
          </div>
        )}
      </div>

      {/* ── Fullscreen overlay (side-by-side edit + live preview) ── */}
      {isMarkdown && isFullscreen && (
        <div
          ref={fsRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)] outline-none"
          onKeyDown={(e) => { if (e.key === 'Escape') setIsFullscreen(false) }}
        >
          {/* Header bar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex-shrink-0">
            <span className="text-xs font-medium text-purple-400">Markdown</span>
            <span className="text-xs text-[var(--color-muted)]">#{cell.position}</span>
            {isDirty && <span className="text-xs text-yellow-500">●</span>}
            <div className="ml-auto flex items-center gap-2">
              {isDirty && (
                <button
                  onClick={handleSave}
                  className="text-xs px-2 py-0.5 rounded text-[var(--color-muted)] hover:text-white hover:bg-white/10"
                >
                  Save
                </button>
              )}
              <button
                onClick={() => { handleSave(); setIsFullscreen(false) }}
                className="text-xs px-2 py-0.5 rounded text-[var(--color-muted)] hover:text-white hover:bg-white/10"
                title="Close fullscreen (Esc)"
              >
                ✕ Close
              </button>
            </div>
          </div>

          {/* Split panels */}
          <div className="flex flex-1 min-h-0">
            {/* Left: editor */}
            <div className="flex-1 flex flex-col border-r border-[var(--color-border)] overflow-hidden">
              <div className="text-xs text-[var(--color-muted)] px-3 py-1 bg-black/20 border-b border-[var(--color-border)] flex-shrink-0">
                Editor
              </div>
              <textarea
                value={source}
                onChange={(e) => handleSourceChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleSave}
                spellCheck={false}
                placeholder="# Markdown content…"
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                className="flex-1 w-full bg-transparent text-[var(--color-text)] p-4 resize-none outline-none leading-relaxed overflow-y-auto font-mono text-sm"
              />
            </div>

            {/* Right: live preview */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="text-xs text-[var(--color-muted)] px-3 py-1 bg-black/20 border-b border-[var(--color-border)] flex-shrink-0">
                Preview <span className="opacity-50 ml-1">(live · 400ms delay)</span>
              </div>
              {/* Two-layer crossfade inside the scrollable area */}
              <div className="flex-1 overflow-y-auto" style={fsCf.containerStyle}>
                {([fsCf.layer0, fsCf.layer1] as const).map((layer, i) => (
                  <div
                    key={i}
                    ref={layer.ref}
                    className="p-4 text-sm text-[var(--color-text)] leading-relaxed prose-invert"
                    style={layer.style}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
