import { useState, useEffect, useRef } from 'react'
import { sendMessage, getMessages } from '../lib/api'
import { MessageBubble } from './MessageBubble'
import { MessageInput } from './MessageInput'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming: boolean
}

type Props = {
  sessionId: string
  onTitle?: (title: string) => void
}

export function ChatWindow({ sessionId, onTitle }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    let cancelled = false
    getMessages(sessionId).then((loaded) => {
      if (!cancelled) {
        setMessages(loaded.map((m) => ({ ...m, streaming: false })))
      }
    }).catch(() => {/* session may be new — ignore */})
    return () => {
      cancelled = true
      cancelRef.current?.()
    }
  }, [sessionId])

  function handleSend(text: string) {
    const userMsgId = crypto.randomUUID()
    const assistantMsgId = crypto.randomUUID()

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: text, streaming: false },
      { id: assistantMsgId, role: 'assistant', content: '', streaming: true },
    ])
    setStreaming(true)

    cancelRef.current = sendMessage(sessionId, text, {
      onTitle,
      onTextDelta: (delta) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: m.content + delta } : m
          )
        )
      },
      onDone: () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, streaming: false } : m
          )
        )
        setStreaming(false)
      },
      onError: (errorMsg) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: `**Error:** ${errorMsg}`, streaming: false }
              : m
          )
        )
        setStreaming(false)
      },
    })
  }

  return (
    <div className="chat-window">
      <div className="chat-window__messages">
        {messages.length === 0 && (
          <div className="chat-window__empty">
            <p>Start a conversation with Claude.</p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            role={m.role}
            content={m.content}
            streaming={m.streaming}
          />
        ))}
        <div ref={bottomRef} />
      </div>
      <MessageInput
        onSend={handleSend}
        onStop={() => {
          cancelRef.current?.()
          setMessages((prev) =>
            prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
          )
          setStreaming(false)
        }}
        disabled={streaming}
      />
    </div>
  )
}
