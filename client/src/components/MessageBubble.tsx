import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import type { ClaudeErrorCode } from '../lib/api'

marked.use({
  breaks: true,
})

type Props = {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  errorCode?: ClaudeErrorCode
}

export function MessageBubble({ role, content, streaming = false, errorCode }: Props) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

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
      <div className={`message message--error message--error--${isSessionExpired ? 'info' : 'fatal'}`}>
        <span className="message__error-icon">{isSessionExpired ? '⚠' : '✕'}</span>
        <p className="message__error-text">{content}</p>
      </div>
    )
  }

  return (
    <div className={`message message--${role}`}>
      {role === 'user' ? (
        <p className="message__content message__content--plain">{content}</p>
      ) : (
        <div className="message__assistant-wrap">
          <div
            ref={contentRef}
            className={`message__content message__content--markdown${streaming ? ' message__content--streaming' : ''}`}
            dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
          />
          {!streaming && content && (
            <button
              className={`message__copy-btn${copied ? ' message__copy-btn--copied' : ''}`}
              onClick={handleCopy}
              title="Copy message"
            >
              {copied ? '✓' : '⎘'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
