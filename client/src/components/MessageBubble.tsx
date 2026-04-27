import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import mermaid from 'mermaid'
import { renderPikchr } from '../lib/pikchrRenderer'
import { renderMdArt } from 'mdart'
import { tryActivateMdArtTabFromEventTarget } from 'mdart/preview'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'
import type { ClaudeErrorCode, ToolCall } from '../lib/api'
import { toolDisplayName, toolDisplayDetail, deriveArtifactName } from '../lib/api'
import {
  splitContent,
  buildMarkedOptions,
  preprocessKaTeX,
  utf8FromBase64,
  escapeHtmlPlain,
} from '../lib/markdownRenderer'
import { HtmlPreview } from './HtmlPreview'
import { ImageLightbox, type LightboxContent } from './ImageLightbox'
import { KernelOutputPanel, type OutputPanelState } from './KernelOutputPanel'
import { runCode, normalizeLanguage } from '../lib/kernelApi'
import { SaveAsCellDialog } from './SaveAsCellDialog'
import type { SaveCellResult } from '../lib/notebookApi'
import type { ArtifactType } from '../lib/api'

// Mermaid is initialized once at module level with a dark theme.
mermaid.initialize({ startOnLoad: false, theme: 'dark' })

marked.use({ breaks: true })

/** Render a markdown segment to sanitized HTML. */
function renderMarkdown(content: string, projectId: string | null): string {
  const purifyOpts = {
    ADD_ATTR: ['data-graph', 'data-src', 'data-type', 'data-runnable-lang', 'style'],
    ADD_TAGS: ['div'],
  }
  try {
    const withKatex = preprocessKaTeX(content)
    const { renderer } = buildMarkedOptions(projectId)
    const html = marked.parse(withKatex, { renderer }) as string
    return DOMPurify.sanitize(html, purifyOpts)
  } catch (err) {
    console.error('renderMarkdown failed', err)
    const fallback = `<pre class="whitespace-pre-wrap break-words text-red-300/90 text-xs">${escapeHtmlPlain(content)}</pre>`
    return DOMPurify.sanitize(fallback, purifyOpts)
  }
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
  createdAt?: number
  onSendToChat?: (text: string) => void
  onSaveAsArtifact?: (content: string, defaultType: ArtifactType, defaultName: string, anchorEl: HTMLElement, language?: string) => void
}

export function MessageBubble({ role, content, streaming = false, errorCode, source, toolUses, onCompact, projectId = null, createdAt, onSendToChat, onSaveAsArtifact }: Props) {
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
  /** Per-message pikchr SVG cache: source → rendered SVG string. */
  const pikchrCache = useRef<Map<string, string>>(new Map())
  /** Per-message mdart SVG cache: source → rendered SVG string. */
  const mdartCache = useRef<Map<string, string>>(new Map())

  // ── Kernel code execution state ─────────────────────────────────────────────
  /** Per-block run state: block index → output panel state */
  const [runStates, setRunStates] = useState<Map<number, OutputPanelState>>(() => new Map())
  /** Ref to DOM mount divs injected after <pre> blocks (portal targets) */
  const outputMountsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  /** Version counter incremented when new mount divs are added, triggering portal renders */
  const [mountVersion, setMountVersion] = useState(0)
  /** Stable ref to the run handler, so DOM event listeners don't close over stale state */
  const handleRunRef = useRef<((idx: number, lang: string, code: string) => void) | undefined>(undefined)

  // ── Save as Cell state ───────────────────────────────────────────────────────
  /** Per-block save dialog: block index → { anchorEl, lang, code } | null */
  const [saveDialogs, setSaveDialogs] = useState<Map<number, { anchorEl: HTMLButtonElement; lang: string; code: string }>>(() => new Map())
  const handleSaveRef = useRef<((idx: number, lang: string, code: string, btn: HTMLButtonElement) => void) | undefined>(undefined)

  // ── Save as Artifact state ────────────────────────────────────────────────────
  const onSaveAsArtifactRef = useRef<typeof onSaveAsArtifact>(undefined)

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

    // Code action buttons: inject a .code-action-group container (flex row) into
    // the top-right of each <pre> block, then append buttons inside it.
    // Order inside group (left → right): 📎 artifact-save, 💾 cell-save, ▶ Run
    // Idempotent — skips blocks that already have a group.
    const EXECUTABLE_LANGS = new Set([
      'python', 'py', 'javascript', 'js', 'typescript', 'ts',
      'bash', 'sh', 'shell', 'cpp', 'c++', 'c',
    ])
    // Copy button: inject on all code blocks as soon as streaming is done (no projectId required)
    if (!streaming) {
      contentRef.current.querySelectorAll<HTMLElement>('pre[data-runnable-lang]').forEach((pre) => {
        let group = pre.querySelector<HTMLDivElement>('.code-action-group')
        if (!group) {
          group = document.createElement('div')
          group.className = 'code-action-group'
          pre.appendChild(group)
        }
        if (!group.querySelector('.copy-btn')) {
          const btn = document.createElement('button')
          btn.className = 'copy-btn'
          btn.title = 'Copy to clipboard'
          btn.textContent = '📋'
          btn.addEventListener('click', (e) => {
            e.stopPropagation()
            const code = pre.querySelector('code')?.textContent ?? ''
            void navigator.clipboard.writeText(code).then(() => {
              btn.textContent = '✓'
              setTimeout(() => { btn.textContent = '📋' }, 1500)
            })
          })
          group.appendChild(btn)
        }
      })
    }

    if (!streaming && projectId) {
      const pres = contentRef.current.querySelectorAll<HTMLElement>('pre[data-runnable-lang]')
      let mountsChanged = false
      pres.forEach((pre, idx) => {
        const lang = (pre.getAttribute('data-runnable-lang') ?? '').toLowerCase()

        // Ensure the shared button group container exists
        let group = pre.querySelector<HTMLDivElement>('.code-action-group')
        if (!group) {
          group = document.createElement('div')
          group.className = 'code-action-group'
          pre.appendChild(group)
        }

        // 🧩 Artifact-save — always shown when callback is available
        if (!group.querySelector('.artifact-save-btn') && onSaveAsArtifactRef.current) {
          const btn = document.createElement('button')
          btn.className = 'artifact-save-btn'
          btn.title = 'Save as artifact'
          btn.textContent = '🧩'
          btn.addEventListener('click', (e) => {
            e.stopPropagation()
            const code = pre.querySelector('code')?.textContent ?? ''
            const defaultType: ArtifactType =
              lang === 'json' ? 'chart' :
              ['md', 'markdown'].includes(lang) ? 'report' :
              ['csv'].includes(lang) ? 'data' :
              'code'
            onSaveAsArtifactRef.current?.(code, defaultType, '', btn as HTMLButtonElement, lang)
          })
          group.appendChild(btn)
        }

        // 💾 Cell-save — middle, only for executable langs
        if (!group.querySelector('.kernel-save-btn') && EXECUTABLE_LANGS.has(lang)) {
          const btn = document.createElement('button')
          btn.className = 'kernel-save-btn'
          btn.textContent = '💾'
          btn.title = 'Save as cell'
          btn.addEventListener('click', (e) => {
            e.stopPropagation()
            const code = pre.querySelector('code')?.textContent ?? ''
            handleSaveRef.current?.(idx, lang, code, btn as HTMLButtonElement)
          })
          group.appendChild(btn)
        }

        // ▶ Run — rightmost, only for executable langs
        if (!group.querySelector('.kernel-run-btn') && EXECUTABLE_LANGS.has(lang)) {
          const btn = document.createElement('button')
          btn.className = 'kernel-run-btn'
          btn.textContent = '▶ Run'
          btn.addEventListener('click', (e) => {
            e.stopPropagation()
            const code = pre.querySelector('code')?.textContent ?? ''
            handleRunRef.current?.(idx, lang, code)
          })
          group.appendChild(btn)
        }

        if (!outputMountsRef.current.has(idx)) {
          const mount = document.createElement('div')
          pre.after(mount)
          outputMountsRef.current.set(idx, mount)
          mountsChanged = true
        }
      })
      if (mountsChanged) setMountVersion(v => v + 1)
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

  // Pikchr rendering — mirrors the mermaid pattern above.
  // Uses the same cache+guard approach: synchronous cache restore handles DOM
  // resets; async first-render waits until streaming is done.
  useEffect(() => {
    if (!contentRef.current || role !== 'assistant' || errorCode) return
    const placeholders = contentRef.current.querySelectorAll<HTMLDivElement>(
      '.pikchr-placeholder:not(.pikchr-rendered)'
    )
    if (placeholders.length === 0) return

    // Inject a 🧩 save-as-artifact button into a rendered pikchr div.
    // No native click listener — handleContentClick dispatches the save via
    // React's synthetic event system (avoids stopPropagation/synthetic ordering issues).
    const injectSaveBtn = (el: HTMLDivElement) => {
      if (el.querySelector('.pikchr-save-btn')) return
      const btn = document.createElement('button')
      btn.className = 'pikchr-save-btn'
      btn.title = 'Save as artifact'
      btn.textContent = '🧩'
      el.appendChild(btn)
    }

    placeholders.forEach((el) => {
      const src = decodeURIComponent(el.getAttribute('data-src') ?? '')
      if (!src) return

      // Fast path: restore from cache
      const cached = pikchrCache.current.get(src)
      if (cached) {
        el.innerHTML = cached
        el.classList.add('pikchr-rendered')
        injectSaveBtn(el)
        return
      }

      // Slow path: wait until streaming is done before the async WASM call
      if (streaming) return

      renderPikchr(src).then((svg) => {
        pikchrCache.current.set(src, svg)
        if (el.isConnected && !el.classList.contains('pikchr-rendered')) {
          el.innerHTML = svg
          el.classList.add('pikchr-rendered')
          injectSaveBtn(el)
        }
      }).catch((err: unknown) => {
        el.classList.add('pikchr-error')
        el.textContent = `Pikchr error: ${String(err)}`
      })
    })
  }) // intentionally no deps — must run after every render

  // MdArt rendering — synchronous (no WASM), mirrors the pikchr pattern.
  // Renders immediately (no need to wait for streaming to finish) since it's
  // pure JS. Still uses cache to survive innerHTML resets from re-renders.
  useEffect(() => {
    if (!contentRef.current || role !== 'assistant' || errorCode) return
    const placeholders = contentRef.current.querySelectorAll<HTMLDivElement>(
      '.mdart-placeholder:not(.mdart-rendered)'
    )
    if (placeholders.length === 0) return

    const injectMdartSaveBtn = (el: HTMLDivElement) => {
      if (el.querySelector('.mdart-save-btn')) return
      const btn = document.createElement('button')
      btn.className = 'mdart-save-btn pikchr-save-btn'
      btn.title = 'Save as artifact'
      btn.textContent = '🧩'
      el.appendChild(btn)
    }

    placeholders.forEach((el) => {
      const src = el.dataset.src ?? ''
      const hintType = el.dataset.type || undefined
      if (!src) return

      const cacheKey = src + '|' + (hintType ?? '')
      const cached = mdartCache.current.get(cacheKey)
      if (cached) {
        el.innerHTML = cached
        el.classList.add('mdart-rendered')
        injectMdartSaveBtn(el)
        return
      }

      try {
        const raw = utf8FromBase64(src)
        const svg = renderMdArt(raw, hintType)
        mdartCache.current.set(cacheKey, svg)
        if (el.isConnected && !el.classList.contains('mdart-rendered')) {
          el.innerHTML = svg
          el.classList.add('mdart-rendered')
          injectMdartSaveBtn(el)
        }
      } catch (e) {
        el.classList.add('mdart-error')
        el.textContent = 'MdArt error: ' + String(e)
      }
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
    // pikchr save button — must be checked before svg to avoid lightbox opening
    if (target.closest('.pikchr-save-btn') && !target.closest('.mdart-placeholder')) {
      const placeholder = target.closest('.pikchr-placeholder') as HTMLDivElement | null
      const src = decodeURIComponent(placeholder?.getAttribute('data-src') ?? '')
      if (src) {
        const name = deriveArtifactName(src, 'pikchr', 'pikchr')
        onSaveAsArtifactRef.current?.(src, 'pikchr', name, target as HTMLElement)
      }
      return
    }

    // MdArt tab-list: switch tab (must run before generic svg → lightbox)
    if (tryActivateMdArtTabFromEventTarget(target)) return

    // mdart save button
    if (target.closest('.mdart-save-btn')) {
      const placeholder = target.closest('.mdart-placeholder') as HTMLDivElement | null
      const encoded = placeholder?.dataset.src ?? ''
      if (encoded) {
        try {
          const raw = utf8FromBase64(encoded)
          const hintType = placeholder?.dataset.type?.trim() ?? ''
          // Prepend type as front-matter if the content has no `type:` line already
          const hasFrontMatterType = /^\s*type\s*:/m.test(raw)
          const content = (!hasFrontMatterType && hintType)
            ? `type: ${hintType}\n\n${raw}`
            : raw
          const name = deriveArtifactName(raw, 'mdart', 'mdart')
          onSaveAsArtifactRef.current?.(content, 'mdart', name, target as HTMLElement)
        } catch { /* ignore decode errors */ }
      }
      return
    }

    // svg click — target may be an inner <path>/<g>/etc., walk up to <svg> root
    const svg = target.closest('svg')
    if (svg) {
      setLightbox({ type: 'svg', markup: svg.outerHTML })
    }
  }

  // Keep handleRunRef.current up-to-date so DOM event listeners see the latest projectId
  handleRunRef.current = (idx: number, lang: string, code: string) => {
    const kernelLang = normalizeLanguage(lang)
    if (!kernelLang || !projectId) return
    const kernelName = 'default'

    // Abort any existing run for this block
    setRunStates(prev => {
      prev.get(idx)?.abort?.()
      return prev
    })

    // Create a stable abort proxy — the real abort fn is assigned after runCode() returns
    const abortProxy = { fn: undefined as (() => void) | undefined }

    setRunStates(prev => new Map(prev).set(idx, {
      status: 'running',
      lines: [],
      exitCode: null,
      durationMs: null,
      abort: () => abortProxy.fn?.(),
    }))

    const abort = runCode(projectId, kernelName, kernelLang, code, (event) => {
      if (event.type === 'output') {
        setRunStates(prev => {
          const cur = prev.get(idx)
          if (!cur) return prev
          return new Map(prev).set(idx, { ...cur, lines: [...cur.lines, event.text] })
        })
      } else if (event.type === 'compile') {
        setRunStates(prev => {
          const cur = prev.get(idx)
          if (!cur) return prev
          return new Map(prev).set(idx, { ...cur, compileOk: event.ok, compileOutput: event.output })
        })
      } else if (event.type === 'done') {
        setRunStates(prev => {
          const cur = prev.get(idx)
          if (!cur) return prev
          return new Map(prev).set(idx, {
            ...cur,
            status: event.exitCode === 0 ? 'done' : 'error',
            exitCode: event.exitCode,
            durationMs: event.durationMs,
            abort: undefined,
          })
        })
      }
    })

    abortProxy.fn = abort
  }

  // Keep artifact save ref up-to-date so DOM listeners see the latest callback
  onSaveAsArtifactRef.current = onSaveAsArtifact

  // Toggle the save dialog for a code block (click again to close)
  handleSaveRef.current = (idx: number, lang: string, code: string, btn: HTMLButtonElement) => {
    setSaveDialogs(prev => {
      const next = new Map(prev)
      if (next.has(idx)) { next.delete(idx) } // toggle off
      else { next.set(idx, { anchorEl: btn, lang, code }) }
      return next
    })
  }

  // Memoize rendered HTML objects so React sees stable references and skips
  // innerHTML resets when unrelated state (runStates, mountVersion, etc.) changes.
  // Without this, every kernel output line triggers a re-render that wipes the
  // injected portal mount divs, making output panels render into detached nodes.
  const renderedSegments = useMemo(() =>
    splitContent(displayContent).map((seg, i) => ({
      seg,
      dangerousHtml: seg.type === 'markdown'
        ? { __html: renderMarkdown(seg.content, projectId) }
        : null,
      key: i,
    })),
    [displayContent, projectId]
  )

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
      provider_quota: {
        icon: '⏱',
        style: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
        message:
          'The AI provider rate limit or quota was reached. Check billing, usage, and plan limits in your provider dashboard, or try again in a few minutes.',
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

  const timeLabel = !streaming && createdAt != null
    ? new Date(createdAt * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div className={`max-w-[820px] w-full flex flex-col
      ${role === 'user' ? 'self-end items-end' : 'self-start items-start'}`}
    >
      {role === 'user' ? (
        <>
          <p className="bg-app-blue-tint px-3.5 py-2.5 rounded-[14px_14px_2px_14px] whitespace-pre-wrap break-words text-sm leading-relaxed max-w-[600px]">
            {displayContent}
          </p>
          {timeLabel && (
            <span className="mt-1 text-[10px] text-app-text-7 select-none">{timeLabel}</span>
          )}
        </>
      ) : (
        <>
          {isScheduled && (
            <div className="flex items-center gap-1.5 text-[11px] text-app-text-6 mb-1.5 select-none">
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
              {renderedSegments.map(({ seg, dangerousHtml, key }) =>
                seg.type === 'html-preview' ? (
                  <HtmlPreview key={key} html={seg.content} />
                ) : (
                  <div
                    key={key}
                    dangerouslySetInnerHTML={dangerousHtml!}
                  />
                )
              )}
            </div>
            {/* Kernel output panels rendered via portals into mount divs injected by useLayoutEffect.
                mountVersion dependency ensures we re-render when new mount divs are created. */}
            {mountVersion >= 0 && Array.from(outputMountsRef.current.entries()).map(([idx, mount]) => {
              const state = runStates.get(idx)
              if (!state) return null
              return createPortal(
                <KernelOutputPanel
                  key={idx}
                  state={state}
                  onSendToChat={(text) => onSendToChat?.(text)}
                  onDismiss={() => setRunStates(prev => { const next = new Map(prev); next.delete(idx); return next })}
                />,
                mount
              )
            })}
            {/* Save as Cell dialogs — portals rendered directly to document.body */}
            {projectId && Array.from(saveDialogs.entries()).map(([idx, { anchorEl, lang, code }]) => (
              <SaveAsCellDialog
                key={idx}
                projectId={projectId}
                language={lang}
                code={code}
                anchorEl={anchorEl}
                onClose={() => setSaveDialogs(prev => { const n = new Map(prev); n.delete(idx); return n })}
                onSaved={(_result: SaveCellResult) => { /* success handled inside dialog (auto-close) */ }}
              />
            ))}
            {!streaming && displayContent && (
              <button
                className={`absolute top-1 right-1 bg-app-bg-card border border-app-border-2 text-app-text-6
                  rounded cursor-pointer text-[13px] leading-none px-1.5 py-0.5 transition-[opacity,color,border-color]
                  opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100
                  hover:text-app-text-2 hover:border-app-border-4
                  ${copied ? '!text-green-400 !border-green-400/30 !opacity-100' : ''}`}
                onClick={handleCopy}
                title="Copy message"
              >
                {copied ? '✓' : '⎘'}
              </button>
            )}
          </div>
          {timeLabel && (
            <span className="mt-1 text-[10px] text-app-text-7 select-none">{timeLabel}</span>
          )}
          {!streaming && toolUses && toolUses.length > 0 && (
            <div className="mt-1.5 w-full">
              <button
                onClick={() => setToolsOpen((o) => !o)}
                className="flex items-center gap-1.5 text-[11px] text-app-text-6 hover:text-app-text-4 transition-colors cursor-pointer bg-transparent border-none p-0"
              >
                <span className={`inline-block transition-transform duration-150 ${toolsOpen ? 'rotate-90' : ''}`}>▶</span>
                <span>{toolUses.map((c) => toolDisplayName(c.name, c.detail)).join(' · ')}</span>
              </button>
              {toolsOpen && (
                <div className="mt-1.5 flex flex-col gap-1 pl-3.5">
                  {toolUses.map((call, i) => (
                    <div key={i} className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className="text-[11px] px-1.5 py-0.5 rounded border border-app-border-2 text-app-text-5 flex-shrink-0">
                          {toolDisplayName(call.name, call.detail)}
                        </span>
                        {toolDisplayDetail(call.name, call.detail) && (
                          <span className="text-[11px] text-app-text-7 truncate" title={call.detail}>
                            {toolDisplayDetail(call.name, call.detail)}
                          </span>
                        )}
                      </div>
                      {call.output && (
                        <pre className="mt-1 text-[11px] text-app-text-6 bg-app-bg border border-app-bg-card rounded px-2 py-1.5 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
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
