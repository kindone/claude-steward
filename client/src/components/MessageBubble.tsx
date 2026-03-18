import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import type { ClaudeErrorCode, ToolCall } from '../lib/api'

marked.use({
  breaks: true,
})

type Props = {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  errorCode?: ClaudeErrorCode
  toolUses?: ToolCall[]
}

export function MessageBubble({ role, content, streaming = false, errorCode, toolUses }: Props) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)

  useEffect(() => {
    if (contentRef.current && role === 'assistant' && !errorCode) {
      contentRef.current.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
        hljs.highlightElement(block as HTMLElement)
      })
    }
  }, [content, role, errorCode])

  async function handleCopy() {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (errorCode) {
    const isSessionExpired = errorCode === 'session_expired'
    return (
      <div className={`flex items-start gap-2 px-3.5 py-2.5 rounded-lg text-sm leading-relaxed
        ${isSessionExpired
          ? 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-300'
          : 'bg-red-500/10 border border-red-500/30 text-red-300'}`}
      >
        <span className="flex-shrink-0 text-sm mt-px">{isSessionExpired ? '⚠' : '✕'}</span>
        <p className="flex-1">{content}</p>
      </div>
    )
  }

  return (
    <div className={`max-w-[820px] w-full flex flex-col
      ${role === 'user' ? 'self-end items-end' : 'self-start items-start'}`}
    >
      {role === 'user' ? (
        <p className="bg-[#1e3a5f] px-3.5 py-2.5 rounded-[14px_14px_2px_14px] whitespace-pre-wrap break-words text-sm leading-relaxed max-w-[600px]">
          {content}
        </p>
      ) : (
        <>
          <div className="group relative w-full">
            <div
              ref={contentRef}
              className={`prose text-sm leading-[1.65] break-words w-full${streaming ? ' streaming-cursor' : ''}`}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(content) as string) }}
            />
            {!streaming && content && (
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
                    <div key={i} className="flex items-baseline gap-1.5 min-w-0">
                      <span className="text-[11px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-[#666] flex-shrink-0">
                        {call.name}
                      </span>
                      {call.detail && (
                        <span className="text-[11px] text-[#444] truncate" title={call.detail}>
                          {call.detail}
                        </span>
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
