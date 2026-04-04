import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import mermaid from 'mermaid'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'
import type { ClaudeErrorCode, ToolCall } from '../lib/api'
import { splitContent, buildMarkedOptions, preprocessKaTeX } from '../lib/markdownRenderer'
import { HtmlPreview } from './HtmlPreview'
import { ImageLightbox, type LightboxContent } from './ImageLightbox'

// Mermaid is initialized once at module level with a dark theme.
mermaid.initialize({ startOnLoad: false, theme: 'dark' })

marked.use({ breaks: true })

/** Render a markdown segment to sanitized HTML. */
function renderMarkdown(content: string, projectId: string | null): string {
  const withKatex = preprocessKaTeX(content)
  const { renderer } = buildMarkedOptions(projectId)
  const html = marked.parse(withKatex, { renderer }) as string
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-graph', 'style'],
  })
}

type Props = {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  errorCode?: ClaudeErrorCode
  source?: string | null
  toolUses?: ToolCall[]
  onCompact?: () => void
  projectId?: string | null
}

export function MessageBubble({ role, content, streaming = false, errorCode, source, toolUses, onCompact, projectId = null }: Props) {
  const displayContent = content
  const isScheduled = source === 'scheduler'
  const contentRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [lightbox, setLightbox] = useState<LightboxContent | null>(null)
  /** Whether the image gallery grid is expanded (false = collapsed, showing first image + count pill). */
  const [galleryExpanded, setGalleryExpanded] = useState(false)
  /** Per-message SVG cache: graph source → rendered SVG string. */
  const mermaidCache = useRef<Map<string, string>>(new Map())

  // Syntax-highlight code blocks after every render.
  //
  // dangerouslySetInnerHTML resets innerHTML on any re-render (e.g. parent
  // state changes like isAtBottom toggling), which wipes hljs-applied
  // <span class="hljs-*"> elements and causes colors to disappear.
  // Running this as a useLayoutEffect with no deps array mirrors the mermaid
  // pattern: it fires synchronously after every render before paint, so hljs
  // re-applies before the user sees unstyled code. The :not(.hljs) selector
  // skips already-highlighted blocks, making each pass cheap.
  //
  // Also builds an image gallery grid when there are 3+ images and streaming
  // has finished — images are moved into a flex container for a compact look.
  useLayoutEffect(() => {
    if (!contentRef.current || role !== 'assistant' || errorCode) return

    // hljs
    contentRef.current.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
      hljs.highlightElement(block as HTMLElement)
    })

    // Gallery grid: only build once streaming ends, and only once per render cycle
    if (!streaming && !contentRef.current.querySelector('.img-gallery-grid')) {
      const imgs = Array.from(contentRef.current.querySelectorAll<HTMLImageElement>('img'))
      if (imgs.length > 2) {
        const grid = document.createElement('div')
        grid.className = 'img-gallery-grid'
        // Insert grid before the first image's paragraph
        const firstParent = imgs[0].closest('p') ?? imgs[0].parentElement
        firstParent?.parentElement?.insertBefore(grid, firstParent)
        // Move all images into the grid, remove parent paragraphs that become
        // empty or contain only <br> / whitespace text nodes (marked wraps
        // consecutive images in one <p> with <br> separators, so those remain).
        imgs.forEach((img) => {
          const parent = img.closest('p') ?? img.parentElement
          grid.appendChild(img)
          if (parent && parent !== grid) {
            const hasRealContent = Array.from(parent.childNodes).some((n) =>
              n.nodeType === Node.ELEMENT_NODE
                ? (n as Element).tagName !== 'BR'
                : (n.textContent?.trim() ?? '') !== ''
            )
            if (!hasRealContent) parent.remove()
          }
        })
        // Add expand pill (shown when collapsed, hidden when expanded via CSS)
        const pill = document.createElement('button')
        pill.className = 'img-gallery-expand'
        pill.dataset.count = String(imgs.length)
        pill.textContent = `+${imgs.length - 1} more`
        grid.appendChild(pill)
        // Add collapse button (shown when expanded, hidden when collapsed via CSS)
        const collapse = document.createElement('button')
        collapse.className = 'img-gallery-collapse'
        collapse.textContent = 'show less'
        grid.appendChild(collapse)
      }
    }

    // Sync collapsed/expanded state onto existing grid (runs every render)
    const grid = contentRef.current?.querySelector<HTMLElement>('.img-gallery-grid')
    if (grid) {
      grid.classList.toggle('is-collapsed', !galleryExpanded)
    }
  }) // intentionally no deps — must run after every render

  // Re-apply Mermaid SVGs after every render.
  //
  // dangerouslySetInnerHTML resets innerHTML whenever React reconciles
  // (e.g. parent state change from the scroll listener), which wipes any SVG
  // previously injected by mermaid.  Running this effect without a dependency
  // array means it runs after every render; cached hits are synchronous so the
  // fix is instantaneous.  New graphs (not yet cached) are only rendered once
  // streaming has finished to avoid the race where rapid DOM resets keep wiping
  // in-progress renders.
  useEffect(() => {
    if (!contentRef.current || role !== 'assistant' || errorCode) return
    const placeholders = contentRef.current.querySelectorAll<HTMLDivElement>(
      '.mermaid-placeholder:not(.mermaid-rendered)'
    )
    if (placeholders.length === 0) return

    placeholders.forEach((el) => {
      const graph = decodeURIComponent(el.getAttribute('data-graph') ?? '')
      if (!graph) return

      // Fast path: restore from cache (handles DOM resets without async round-trip)
      const cached = mermaidCache.current.get(graph)
      if (cached) {
        el.innerHTML = cached
        el.classList.add('mermaid-rendered')
        return
      }

      // Slow path: first render — wait until streaming is done
      if (streaming) return

      const id = `mermaid-${Math.random().toString(36).slice(2)}`
      mermaid.render(id, graph).then(({ svg }) => {
        mermaidCache.current.set(graph, svg)
        // Guard: element may have been reset again while render was in flight
        if (el.isConnected && !el.classList.contains('mermaid-rendered')) {
          el.innerHTML = svg
          el.classList.add('mermaid-rendered')
        }
      }).catch((err: unknown) => {
        el.classList.add('mermaid-error')
        el.textContent = `Mermaid error: ${String(err)}`
      })
    })
  }) // intentionally no deps — must run after every render

  function handleContentClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as Element

    // Expand / collapse pill clicks
    if (target.closest('.img-gallery-expand')) { setGalleryExpanded(true);  return }
    if (target.closest('.img-gallery-collapse')) { setGalleryExpanded(false); return }

    // img click — open gallery lightbox if 3+ images, else single lightbox
    const img = target.closest('img') as HTMLImageElement | null
    if (img) {
      const grid = contentRef.current?.querySelector('.img-gallery-grid')
      if (grid) {
        // Gallery mode: collect all images in order and find the clicked index
        const allImgs = Array.from(grid.querySelectorAll<HTMLImageElement>('img'))
        const idx = allImgs.indexOf(img)
        setLightbox({
          type: 'gallery',
          images: allImgs.map((i) => ({ src: i.src, alt: i.getAttribute('alt') ?? '' })),
          startIndex: Math.max(0, idx),
        })
      } else {
        setLightbox({ type: 'img', src: img.src, alt: img.getAttribute('alt') ?? '' })
      }
      return
    }
    // svg click — target may be an inner <path>/<g>/etc., walk up to <svg> root
    const svg = target.closest('svg')
    if (svg) {
      setLightbox({ type: 'svg', markup: svg.outerHTML })
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(displayContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (errorCode) {
    const errorMeta: Record<string, { icon: string; style: string; message: string }> = {
      context_limit: {
        icon: '⚠',
        style: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300',
        message: 'Context limit reached — your next message will start a fresh conversation.',
      },
      session_expired: {
        icon: '⚠',
        style: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300',
        message: 'Session ended — your next message will start a fresh conversation.',
      },
      process_error: {
        icon: '✕',
        style: 'bg-red-500/10 border-red-500/30 text-red-300',
        message: content || 'Something went wrong. You can try sending your message again.',
      },
      http_error: {
        icon: '✕',
        style: 'bg-red-500/10 border-red-500/30 text-red-300',
        message: content || 'Connection error. Please try again.',
      },
    }
    const { icon, style, message } = errorMeta[errorCode] ?? errorMeta.process_error
    const hasPartialContent = displayContent && errorCode !== 'process_error' && errorCode !== 'http_error'
    return (
      <div className="max-w-[820px] w-full flex flex-col gap-2 self-start items-start">
        {hasPartialContent && (
          <div
            ref={contentRef}
            className="prose text-sm leading-[1.65] break-words w-full"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(displayContent, projectId) }}
          />
        )}
        <div className={`flex items-start gap-2 px-3.5 py-2.5 rounded-lg text-sm leading-relaxed border w-full ${style}`}>
          <span className="flex-shrink-0 text-sm mt-px">{icon}</span>
          <div className="flex-1 flex flex-col gap-2">
            <p>{message}</p>
            {errorCode === 'context_limit' && onCompact && (
              <button
                onClick={onCompact}
                className="self-start bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/40 text-yellow-300 rounded px-2.5 py-1 text-xs cursor-pointer transition-colors"
              >
                Compact &amp; Continue
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`max-w-[820px] w-full flex flex-col
      ${role === 'user' ? 'self-end items-end' : 'self-start items-start'}`}
    >
      {role === 'user' ? (
        <p className="bg-[#1e3a5f] px-3.5 py-2.5 rounded-[14px_14px_2px_14px] whitespace-pre-wrap break-words text-sm leading-relaxed max-w-[600px]">
          {displayContent}
        </p>
      ) : (
        <>
          {isScheduled && (
            <div className="flex items-center gap-1.5 text-[11px] text-[#555] mb-1.5 select-none">
              <span>⏰</span>
              <span>Scheduled</span>
            </div>
          )}
          <div className="group relative w-full">
            <div
              ref={contentRef}
              className={`prose text-sm leading-[1.65] break-words w-full${streaming ? ' streaming-cursor' : ''}`}
              onClick={handleContentClick}
            >
              {splitContent(displayContent).map((seg, i) =>
                seg.type === 'html-preview' ? (
                  <HtmlPreview key={i} html={seg.content} />
                ) : (
                  <div
                    key={i}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.content, projectId) }}
                  />
                )
              )}
            </div>
            {!streaming && displayContent && (
              <button
                className={`absolute top-1 right-1 bg-[#1a1a1a] border border-[#2a2a2a] text-[#555]
                  rounded cursor-pointer text-[13px] leading-none px-1.5 py-0.5 transition-[opacity,color,border-color]
                  opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100
                  hover:text-[#ccc] hover:border-[#444]
                  ${copied ? '!text-green-400 !border-green-400/30 !opacity-100' : ''}`}
                onClick={handleCopy}
                title="Copy message"
              >
                {copied ? '✓' : '⎘'}
              </button>
            )}
          </div>
          {!streaming && toolUses && toolUses.length > 0 && (
            <div className="mt-1.5 w-full">
              <button
                onClick={() => setToolsOpen((o) => !o)}
                className="flex items-center gap-1.5 text-[11px] text-[#555] hover:text-[#888] transition-colors cursor-pointer bg-transparent border-none p-0"
              >
                <span className={`inline-block transition-transform duration-150 ${toolsOpen ? 'rotate-90' : ''}`}>▶</span>
                <span>{toolUses.map((c) => c.name).join(' · ')}</span>
              </button>
              {toolsOpen && (
                <div className="mt-1.5 flex flex-col gap-1 pl-3.5">
                  {toolUses.map((call, i) => (
                    <div key={i} className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className="text-[11px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-[#666] flex-shrink-0">
                          {call.name}
                        </span>
                        {call.detail && (
                          <span className="text-[11px] text-[#444] truncate" title={call.detail}>
                            {call.detail}
                          </span>
                        )}
                      </div>
                      {call.output && (
                        <pre className="mt-1 text-[11px] text-[#555] bg-[#0d0d0d] border border-[#1a1a1a] rounded px-2 py-1.5 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
                          {(() => {
                            // Safety guard: output should always be a string, but Claude API
                            // tool_result content can be an array of blocks — normalize defensively.
                            const out = typeof call.output === 'string'
                              ? call.output
                              : JSON.stringify(call.output)
                            return out.length > 2000 ? out.slice(0, 2000) + '\n… (truncated)' : out
                          })()}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {lightbox && <ImageLightbox content={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}
