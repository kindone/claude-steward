import { useState, useRef, useEffect, useMemo } from 'react'
import { marked } from 'marked'
import type { ChatMessage, ChatSession, ToolCall } from '../types'
import { streamChat, listChatSessions, createChatSession, deleteChatSession, getChatMessages, compactChatSession } from '../api'

marked.setOptions({ gfm: true, breaks: true })

const MODEL_OPTIONS: { value: string | null; label: string }[] = [
  { value: null,                  label: 'Default' },
  { value: 'claude-opus-4-6',    label: 'Opus 4.6' },
  { value: 'claude-sonnet-4-6',  label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-5',    label: 'Opus 4.5' },
  { value: 'claude-sonnet-4-5',  label: 'Sonnet 4.5' },
]

interface Props {
  notebookId: string
  onCellRunByAI?: (cellId: string | null) => void
  onCellUpdatedByAI?: (cellId: string) => void
}

export function ChatPanel({ notebookId, onCellRunByAI }: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [model, setModel] = useState<string | null>(null)
  const [isCompacting, setIsCompacting] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const streamingMsgIdRef = useRef<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const msgIdRef = useRef(0)

  const nextId = () => String(++msgIdRef.current)

  // Load sessions on mount / notebook switch
  useEffect(() => {
    let cancelled = false
    setLoadingSessions(true)
    setSessions([])
    setActiveSessionId(null)
    setMessages([])

    listChatSessions(notebookId).then(async (loaded) => {
      if (cancelled) return
      setSessions(loaded)
      setLoadingSessions(false)

      if (loaded.length > 0) {
        // Activate the most recent session
        const latest = loaded[loaded.length - 1]
        setActiveSessionId(latest.id)
      }
      // If no sessions, we wait until user sends first message (lazy creation)
    })

    return () => { cancelled = true }
  }, [notebookId])

  // Load messages when active session changes
  useEffect(() => {
    if (!activeSessionId) { setMessages([]); return }
    let cancelled = false
    setLoadingHistory(true)
    setMessages([])

    getChatMessages(notebookId, activeSessionId).then(msgs => {
      if (cancelled) return
      setMessages(msgs)
      setLoadingHistory(false)
    }).catch(() => setLoadingHistory(false))

    return () => { cancelled = true }
  }, [notebookId, activeSessionId])

  // Track whether user has scrolled away from the bottom
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      setShowScrollBtn(!atBottom)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Scroll to bottom instantly when history finishes loading
  useEffect(() => {
    if (!loadingHistory) bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [loadingHistory])

  // Scroll to bottom on new messages — only if already near the bottom
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    setShowScrollBtn(false)
  }

  const handleNewSession = async () => {
    const session = await createChatSession(notebookId)
    setSessions(prev => [...prev, session])
    setActiveSessionId(session.id)
  }

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await deleteChatSession(notebookId, sessionId)
    setSessions(prev => {
      const next = prev.filter(s => s.id !== sessionId)
      if (activeSessionId === sessionId) {
        // Activate adjacent session or clear
        const idx = prev.findIndex(s => s.id === sessionId)
        const fallback = next[Math.max(0, idx - 1)]
        setActiveSessionId(fallback?.id ?? null)
      }
      return next
    })
  }

  const handleCompact = async () => {
    if (!activeSessionId || isCompacting || isSending) return
    setIsCompacting(true)
    try {
      await compactChatSession(notebookId, activeSessionId)
      // Keep history visible — append a divider so user knows where context was reset
      setMessages(prev => [...prev, {
        id: `divider-${Date.now()}`,
        role: 'divider' as const,
        content: '— compacted —',
      }])
    } catch (err) {
      console.error('[compact]', err)
    } finally {
      setIsCompacting(false)
    }
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isSending) return
    setInput('')
    setIsSending(true)

    // Lazily create a session if none exists yet
    let sessionId = activeSessionId
    if (!sessionId) {
      const session = await createChatSession(notebookId)
      setSessions(prev => [...prev, session])
      setActiveSessionId(session.id)
      sessionId = session.id
    }

    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: text }
    const assistantId = nextId()
    const assistantMsg: ChatMessage = {
      id: assistantId, role: 'assistant', content: '', isStreaming: true, toolCalls: [],
    }
    setMessages(prev => [...prev, userMsg, assistantMsg])

    // If session was titled "New chat", update title optimistically from first message
    setSessions(prev => prev.map(s =>
      s.id === sessionId && s.title === 'New chat'
        ? { ...s, title: text.slice(0, 40) + (text.length > 40 ? '…' : '') }
        : s
    ))

    streamingMsgIdRef.current = assistantId

    const ac = new AbortController()
    abortRef.current = ac

    let accText = ''
    const toolCalls: ToolCall[] = []

    streamChat(
      notebookId,
      sessionId,
      text,
      (chunk: unknown) => {
        const c = chunk as Record<string, unknown>

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
                if (!toolCalls.find(t => t.id === tc.id)) {
                  toolCalls.push(tc)
                  setMessages(prev => prev.map(m =>
                    m.id === assistantId ? { ...m, toolCalls: [...toolCalls] } : m
                  ))
                }
                if (tc.name === 'mcp__notebook-pro__run_cell') {
                  onCellRunByAI?.(tc.input?.cell_id as string ?? null)
                } else if (tc.name === 'Bash') {
                  const cmd = (tc.input?.command as string) ?? ''
                  const match = cmd.match(/run_cell\.sh\s+([a-f0-9-]{36})/)
                  if (match) onCellRunByAI?.(match[1])
                }
              }
            }
          }
        }

        if (c.type === 'user') onCellRunByAI?.(null)
      },
      (_sid) => {
        streamingMsgIdRef.current = null
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, isStreaming: false } : m
        ))
        setIsSending(false)
        abortRef.current = null
      },
      (err) => {
        streamingMsgIdRef.current = null
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: m.content || err.message, isStreaming: false, isError: true }
            : m
        ))
        setIsSending(false)
        abortRef.current = null
        onCellRunByAI?.(null)
      },
      ac.signal,
      model,
    )
  }

  const handleStop = () => {
    const stoppingId = streamingMsgIdRef.current
    streamingMsgIdRef.current = null
    abortRef.current?.abort()
    abortRef.current = null
    setIsSending(false)
    if (stoppingId) {
      setMessages(prev => prev.map(m =>
        m.id === stoppingId ? { ...m, isStreaming: false } : m
      ))
    }
    onCellRunByAI?.(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Session tabs */}
      <div className="flex items-center gap-0.5 px-2 pt-2 pb-0 border-b border-[var(--color-border)] overflow-x-auto flex-shrink-0">
        {loadingSessions ? (
          <span className="text-xs text-[var(--color-muted)] px-2 pb-2">Loading…</span>
        ) : (
          <>
            {sessions.map(s => (
              <SessionTab
                key={s.id}
                session={s}
                active={s.id === activeSessionId}
                onClick={() => setActiveSessionId(s.id)}
                onDelete={(e) => handleDeleteSession(s.id, e)}
              />
            ))}
            <button
              onClick={handleNewSession}
              className="flex-shrink-0 mb-1 px-2 py-0.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-white/5 rounded transition-colors"
              title="New chat session"
            >
              +
            </button>

            {/* Compact + model controls pushed to the right */}
            <div className="flex-1" />
            <button
              onClick={handleCompact}
              disabled={!activeSessionId || isCompacting || isSending || messages.length === 0}
              className="flex-shrink-0 mb-1 px-2 py-0.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-white/5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Summarize conversation into a new session"
            >
              {isCompacting ? '⏳' : '⊙ Compact'}
            </button>
            <select
              value={model ?? ''}
              onChange={e => setModel(e.target.value || null)}
              className="flex-shrink-0 mb-1 text-xs bg-transparent text-[var(--color-muted)] hover:text-[var(--color-text)] border-none outline-none cursor-pointer"
              title="Select model"
            >
              {MODEL_OPTIONS.map(opt => (
                <option key={opt.value ?? '__default'} value={opt.value ?? ''}>
                  {opt.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div ref={scrollContainerRef} className="h-full overflow-y-auto p-4 space-y-4">
          {loadingHistory ? (
            <div className="flex items-center gap-2 justify-center mt-8 text-[var(--color-muted)] text-sm">
              <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
              Loading history…
            </div>
          ) : !activeSessionId || messages.length === 0 ? (
            <div className="text-center text-[var(--color-muted)] text-sm mt-8">
              <p>Ask me anything about your notebook.</p>
              <p className="mt-1 text-xs">I can create cells, write code, run them, and explain results.</p>
            </div>
          ) : null}

          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Scroll to bottom button */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)] shadow-md transition-colors text-sm"
            title="Scroll to bottom"
          >
            ↓
          </button>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[var(--color-border)] p-3 flex-shrink-0"
           style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
            }}
            placeholder={activeSessionId ? 'Ask Claude…' : 'Start a new chat…'}
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

// ── Session tab ───────────────────────────────────────────────────────────────

function SessionTab({
  session, active, onClick, onDelete,
}: {
  session: ChatSession
  active: boolean
  onClick: () => void
  onDelete: (e: React.MouseEvent) => void
}) {
  const [confirming, setConfirming] = useState(false)

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirming(true)
  }

  const handleConfirm = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirming(false)
    onDelete(e)
  }

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirming(false)
  }

  if (confirming) {
    return (
      <div className={`flex items-center gap-1 flex-shrink-0 mb-1 px-2 py-0.5 rounded text-xs border ${
        active
          ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)]/30'
          : 'bg-red-500/10 border-red-500/20'
      }`}>
        <span className="text-red-400 whitespace-nowrap">Delete?</span>
        <button onClick={handleConfirm} className="text-red-400 hover:text-red-300 font-medium px-0.5">✓</button>
        <button onClick={handleCancel} className="text-[var(--color-muted)] hover:text-[var(--color-text)] px-0.5">✕</button>
      </div>
    )
  }

  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-1 flex-shrink-0 mb-1 px-2.5 py-0.5 rounded text-xs max-w-[140px] transition-colors ${
        active
          ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30'
          : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-white/5'
      }`}
      title={session.title}
    >
      <span className="truncate">{session.title}</span>
      <span
        role="button"
        onClick={handleDeleteClick}
        className="flex-shrink-0 opacity-60 sm:opacity-0 sm:group-hover:opacity-60 hover:!opacity-100 ml-0.5 leading-none"
        title="Delete session"
      >
        ×
      </span>
    </button>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'divider') {
    return (
      <div className="flex items-center gap-2 my-2">
        <div className="flex-1 h-px bg-[var(--color-border)]" />
        <span className="text-xs text-[var(--color-muted)] flex-shrink-0">compacted</span>
        <div className="flex-1 h-px bg-[var(--color-border)]" />
      </div>
    )
  }

  const isUser = message.role === 'user'

  const htmlContent = useMemo(() => {
    if (isUser || !message.content) return null
    return marked.parse(message.content) as string
  }, [isUser, message.content])

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
          isUser ? (
            <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
          ) : (
            <div
              className="prose-chat leading-relaxed"
              dangerouslySetInnerHTML={{ __html: htmlContent ?? '' }}
            />
          )
        )}

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

// ── Tool call badge ───────────────────────────────────────────────────────────

function ToolCallBadge({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false)

  const label = (() => {
    if (toolCall.name === 'mcp__notebook-pro__run_cell') {
      return `▶ run_cell ${((toolCall.input?.cell_id as string) ?? '').slice(0, 8)}…`
    }
    if (toolCall.name === 'mcp__notebook-pro__create_cell') return `+ create_cell (${toolCall.input?.language ?? ''})`
    if (toolCall.name === 'mcp__notebook-pro__list_cells') return '📋 list_cells'
    if (toolCall.name === 'mcp__notebook-pro__delete_cell') {
      return `🗑 delete_cell ${((toolCall.input?.cell_id as string) ?? '').slice(0, 8)}…`
    }
    if (toolCall.name === 'Bash') {
      const cmd = (toolCall.input?.command as string) ?? ''
      const match = cmd.match(/run_cell\.sh\s+([a-f0-9-]{8})/)
      return match ? `▶ run_cell ${match[1]}…` : '⚙ Bash'
    }
    if (toolCall.name === 'Edit' || toolCall.name === 'Write') return `✎ ${toolCall.name}`
    return `⚙ ${toolCall.name}`
  })()

  return (
    <button onClick={() => setExpanded(!expanded)} className="block text-left w-full">
      <span className="text-xs px-2 py-0.5 rounded bg-white/5 text-[var(--color-muted)] hover:bg-white/10">{label}</span>
      {expanded && (
        <pre className="mt-1 text-xs text-[var(--color-muted)] whitespace-pre-wrap bg-black/20 rounded p-2 max-h-40 overflow-y-auto">
          {JSON.stringify(toolCall.input, null, 2)}
        </pre>
      )}
    </button>
  )
}
