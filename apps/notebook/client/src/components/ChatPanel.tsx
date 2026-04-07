import { useState, useRef, useEffect } from 'react'
import type { ChatMessage, ToolCall } from '../types'
import { streamChat, clearSession } from '../api'

interface Props {
  notebookId: string
  onCellRunByAI?: (cellId: string | null) => void
  onCellUpdatedByAI?: (cellId: string) => void
}

export function ChatPanel({ notebookId, onCellRunByAI, onCellUpdatedByAI }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const msgIdRef = useRef(0)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const nextId = () => String(++msgIdRef.current)

  const handleSend = () => {
    const text = input.trim()
    if (!text || isSending) return

    setInput('')
    setIsSending(true)

    // Add user message
    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: text }
    const assistantId = nextId()
    const assistantMsg: ChatMessage = {
      id: assistantId, role: 'assistant', content: '', isStreaming: true, toolCalls: [],
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])

    const ac = new AbortController()
    abortRef.current = ac

    let accText = ''
    const toolCalls: ToolCall[] = []

    streamChat(
      notebookId,
      text,
      (chunk: unknown) => {
        const c = chunk as Record<string, unknown>

        // Text delta
        if (c.type === 'stream_event') {
          const evt = c.event as Record<string, unknown>
          if (evt?.type === 'content_block_delta') {
            const delta = evt.delta as Record<string, unknown>
            if (delta?.type === 'text_delta') {
              accText += delta.text as string
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: accText } : m
              ))
            }
          }
        }

        // Tool calls
        if (c.type === 'assistant') {
          const content = (c.message as Record<string, unknown>)?.content as Array<Record<string, unknown>>
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use') {
                const tc: ToolCall = {
                  id: block.id as string,
                  name: block.name as string,
                  input: block.input as Record<string, unknown>,
                }
                toolCalls.push(tc)
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, toolCalls: [...toolCalls] } : m
                ))

                // Detect run_cell.sh calls
                if (tc.name === 'Bash') {
                  const cmd = (tc.input?.command as string) ?? ''
                  const match = cmd.match(/run_cell\.sh\s+([a-f0-9-]{36})/)
                  if (match) onCellRunByAI?.(match[1])
                }
              }
            }
          }
        }

        // Tool result (cell ran — clear the highlight)
        if (c.type === 'user') {
          onCellRunByAI?.(null)
        }
      },
      (_sessionId) => {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, isStreaming: false } : m
        ))
        setIsSending(false)
        abortRef.current = null
      },
      (err) => {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: err.message, isStreaming: false, isError: true }
            : m
        ))
        setIsSending(false)
        abortRef.current = null
        onCellRunByAI?.(null)
      },
      ac.signal,
    )
  }

  const handleStop = () => {
    abortRef.current?.abort()
    setIsSending(false)
    onCellRunByAI?.(null)
  }

  const handleClear = async () => {
    await clearSession(notebookId)
    setMessages([])
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]">
        <span className="text-sm font-medium text-[var(--color-text)]">AI Assistant</span>
        <button
          onClick={handleClear}
          className="text-xs text-[var(--color-muted)] hover:text-white"
          title="Clear conversation"
        >
          Clear
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-[var(--color-muted)] text-sm mt-8">
            <p>Ask me anything about your notebook.</p>
            <p className="mt-1 text-xs">I can create cells, write code, run them, and explain results.</p>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[var(--color-border)] p-3 flex-shrink-0"
           style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Ask Claude…"
            rows={2}
            className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] resize-none outline-none focus:border-[var(--color-accent)]"
          />
          <button
            onClick={isSending ? handleStop : handleSend}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isSending
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent)]/80'
            }`}
          >
            {isSending ? '■' : '↑'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
        isUser
          ? 'bg-[var(--color-accent)] text-white'
          : message.isError
          ? 'bg-red-500/10 border border-red-500/20 text-red-400'
          : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]'
      }`}>
        {message.content && (
          <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
        )}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map(tc => (
              <ToolCallBadge key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}

        {message.isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-current opacity-70 animate-pulse ml-0.5" />
        )}
      </div>
    </div>
  )
}

function ToolCallBadge({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const cmd = (toolCall.input?.command as string) ?? ''
  const isRunCell = cmd.includes('run_cell.sh')
  const isEdit = toolCall.name === 'Edit' || toolCall.name === 'Write'

  const label = isRunCell
    ? `▶ run_cell ${cmd.match(/([a-f0-9-]{8})/)?.[1] ?? ''}…`
    : isEdit
    ? `✎ ${toolCall.name}`
    : `⚙ ${toolCall.name}`

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="block text-left w-full"
    >
      <span className="text-xs px-2 py-0.5 rounded bg-white/5 text-[var(--color-muted)] hover:bg-white/10">
        {label}
      </span>
      {expanded && (
        <pre className="mt-1 text-xs text-[var(--color-muted)] whitespace-pre-wrap bg-black/20 rounded p-2 max-h-40 overflow-y-auto">
          {JSON.stringify(toolCall.input, null, 2)}
        </pre>
      )}
    </button>
  )
}
