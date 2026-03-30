import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import mermaid from 'mermaid'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'
import type { ClaudeErrorCode, ToolCall } from '../lib/api'
import { splitContent, buildMarkedOptions, preprocessKaTeX } from '../lib/markdownRenderer'
import { HtmlPreview } from './HtmlPreview'

// Mermaid is initialized once at module level with a dark theme.
mermaid.initialize({ startOnLoad: false, theme: 'dark' })

marked.use({ breaks: true })

const SCHEDULE_BLOCK_RE = /<schedule>[\s\S]*?<\/schedule>/g

/** Strip <schedule> blocks from content before rendering — they're processed server-side. */
function stripScheduleBlocks(text: string): string {
  return text.replace(SCHEDULE_BLOCK_RE, '').trim()
}

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
  const displayContent = role === 'assistant' ? stripScheduleBlocks(content) : content
  const isScheduled = source === 'scheduler'
  const contentRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  /** Per-message SVG cache: graph source → rendered SVG string. */
  const mermaidCache = useRef<Map<string, string>>(new Map())

  // Syntax-highlight code blocks after render
  useEffect(() => {
    if (contentRef.current && role === 'assistant' && !errorCode) {
      contentRef.current.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
        hljs.highlightElement(block as HTMLElement)
      })
    }
  }, [displayContent, role, errorCode])

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
                          {call.output.length > 2000 ? call.output.slice(0, 2000) + '\n… (truncated)' : call.output}
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
    </div>
  )
}
