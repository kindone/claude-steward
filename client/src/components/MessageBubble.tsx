import { useEffect, useRef } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

marked.use({
  breaks: true,
})

type Props = {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

export function MessageBubble({ role, content, streaming = false }: Props) {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (contentRef.current && role === 'assistant') {
      contentRef.current.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
        hljs.highlightElement(block as HTMLElement)
      })
    }
  }, [content, role])

  return (
    <div className={`message message--${role}`}>
      {role === 'user' ? (
        <p className="message__content message__content--plain">{content}</p>
      ) : (
        <div
          ref={contentRef}
          className={`message__content message__content--markdown${streaming ? ' message__content--streaming' : ''}`}
          dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
        />
      )}
    </div>
  )
}
