import { useState, useEffect, useRef, useCallback } from 'react'
import { sendMessage, stopChat, getMessages, watchSession, updateSystemPrompt, updatePermissionMode, type ClaudeErrorCode, type PermissionMode, type ToolCall } from '../lib/api'
import { usePushNotifications } from '../hooks/usePushNotifications'

const MODES: { value: PermissionMode; label: string; title: string }[] = [
  { value: 'plan',              label: 'Plan', title: 'Read-only — Claude can analyse but not edit or run commands' },
  { value: 'acceptEdits',       label: 'Edit', title: 'Claude can read and write files but not run shell commands' },
  { value: 'bypassPermissions', label: 'Full', title: 'Claude can run any tool including shell commands' },
]
import { MessageBubble } from './MessageBubble'
import { MessageInput } from './MessageInput'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming: boolean
  errorCode?: ClaudeErrorCode
  /** Tool calls made while generating this message, in invocation order. */
  toolUses?: ToolCall[]
}

type Props = {
  sessionId: string
  systemPrompt: string | null
  permissionMode: PermissionMode
  onTitle?: (title: string) => void
  onActivity?: () => void
  onSystemPromptChange?: (prompt: string | null) => void
  onPermissionModeChange?: (mode: PermissionMode) => void
}

export function ChatWindow({ sessionId, systemPrompt, permissionMode, onTitle, onActivity, onSystemPromptChange, onPermissionModeChange }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamingTool, setStreamingTool] = useState<string | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState(systemPrompt ?? '')
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  /** 'instant' on first load, 'smooth' during streaming, 'none' when prepending older messages. */
  const scrollBehaviorRef = useRef<'instant' | 'smooth' | 'none'>('instant')
  const cancelRef = useRef<(() => void) | null>(null)
  /** True while we have an active sendMessage() — poll must not overwrite the optimistic assistant bubble. */
  const streamingFromSendRef = useRef(false)
  /** Accumulates tool calls (with detail) as assistant chunks arrive during the current send. */
  const toolUsesRef = useRef<ToolCall[]>([])
  /** Live copy of toolUsesRef for rendering the streaming indicator. */
  const [streamingToolUses, setStreamingToolUses] = useState<ToolCall[]>([])
  const { state: pushState, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePushNotifications()

  // Sync draft when switching sessions
  useEffect(() => {
    setPromptDraft(systemPrompt ?? '')
    setPromptOpen(false)
  }, [sessionId, systemPrompt])

  async function handlePromptSave() {
    const value = promptDraft.trim() || null
    await updateSystemPrompt(sessionId, value)
    onSystemPromptChange?.(value)
    setPromptOpen(false)
  }

  async function handleModeChange(mode: PermissionMode) {
    await updatePermissionMode(sessionId, mode)
    onPermissionModeChange?.(mode)
  }

  function handlePromptKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setPromptDraft(systemPrompt ?? ''); setPromptOpen(false) }
  }

  useEffect(() => {
    const behavior = scrollBehaviorRef.current
    if (behavior === 'none') {
      // loadOlder prepended messages — don't scroll, position already restored by loadOlder
      scrollBehaviorRef.current = 'smooth'
      return
    }
    bottomRef.current?.scrollIntoView({ behavior })
    // After initial snap, switch to smooth for streaming deltas
    if (behavior === 'instant') scrollBehaviorRef.current = 'smooth'
  }, [messages])

  useEffect(() => {
    streamingFromSendRef.current = false
    let cancelled = false
    let cancelWatch: (() => void) | null = null

    getMessages(sessionId).then((page) => {
      if (cancelled) return
      setMessages(page.messages.map((m) => ({ ...m, streaming: false })))
      setHasMore(page.hasMore)
      // If the last message is from the user, Claude is still (or was) processing.
      // Subscribe via SSE so the UI updates the instant the response lands — no poll ceiling.
      if (page.messages.length > 0 && page.messages[page.messages.length - 1].role === 'user') {
        setStreaming(true)
        cancelWatch = watchSession(
          sessionId,
          async () => {
            if (cancelled) return
            try {
              const fresh = await getMessages(sessionId)
              setMessages(fresh.messages.map((m) => ({ ...m, streaming: false })))
              setHasMore(fresh.hasMore)
            } finally {
              setStreaming(false)
            }
          },
          () => { if (!cancelled) setStreaming(false) },
        )
      }
    }).catch(() => {/* session may be new — ignore */})

    return () => {
      cancelled = true
      cancelRef.current?.()
      cancelWatch?.()
    }
  }, [sessionId])

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || messages.length === 0) return
    const oldestId = messages[0].id
    setLoadingOlder(true)
    try {
      const page = await getMessages(sessionId, { before: oldestId })
      if (page.messages.length === 0) { setHasMore(false); return }
      // Save scroll anchor so prepending doesn't jump to bottom
      const container = scrollContainerRef.current
      const prevScrollHeight = container?.scrollHeight ?? 0
      scrollBehaviorRef.current = 'none'
      setMessages((prev) => [...page.messages.map((m) => ({ ...m, streaming: false })), ...prev])
      setHasMore(page.hasMore)
      // Restore position: shift scrollTop by the new content height added above
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop += container.scrollHeight - prevScrollHeight
        }
      })
    } catch (err) {
      console.error('Failed to load older messages', err)
    } finally {
      setLoadingOlder(false)
    }
  }, [sessionId, hasMore, loadingOlder, messages])

  function generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
  }

  function handleSend(text: string) {
    const userMsgId = generateId()
    const assistantMsgId = generateId()

    streamingFromSendRef.current = true
    toolUsesRef.current = []
    setStreamingTool(null)
    setStreamingToolUses([])
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: text, streaming: false },
      { id: assistantMsgId, role: 'assistant', content: '', streaming: true },
    ])
    setStreaming(true)

    cancelRef.current = sendMessage(sessionId, text, {
      onTitle,
      onActivity,
      onTextDelta: (delta) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: m.content + delta } : m
          )
        )
      },
      onToolActivity: (toolName) => {
        setStreamingTool(toolName)
      },
      onToolCall: (call) => {
        toolUsesRef.current = [...toolUsesRef.current, call]
        setStreamingToolUses([...toolUsesRef.current])
      },
      onDone: () => {
        streamingFromSendRef.current = false
        setStreamingTool(null)
        const capturedToolUses = toolUsesRef.current.length > 0 ? [...toolUsesRef.current] : undefined
        setStreamingToolUses([])
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, streaming: false, toolUses: capturedToolUses } : m
          )
        )
        setStreaming(false)
      },
      onError: (errorMsg, code) => {
        streamingFromSendRef.current = false
        setStreamingTool(null)
        setStreamingToolUses([])
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: errorMsg, streaming: false, errorCode: code }
              : m
          )
        )
        setStreaming(false)
      },
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Session header: system prompt toggle + permission mode selector */}
      <div className="flex-shrink-0 border-b border-[#1a1a1a]">
        <div className="flex items-center justify-between px-2">
          <button
            className={`bg-transparent border-none cursor-pointer text-xs py-1.5 px-1.5 text-left transition-colors flex-shrink-0
              ${systemPrompt ? 'text-blue-500 hover:text-blue-400' : 'text-[#444] hover:text-[#888]'}`}
            onClick={() => setPromptOpen((o) => !o)}
            title="System prompt"
          >
            {systemPrompt ? '⚙ Prompt set' : '⚙ Prompt'}
          </button>

          <span className="flex items-center gap-2">
            {/* Permission mode segmented control */}
            <span className="inline-flex border border-[#222] rounded overflow-hidden">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  className={`bg-transparent border-r border-[#222] last:border-r-0 cursor-pointer text-xs px-3 py-2 transition-colors
                    ${permissionMode === m.value
                      ? 'bg-[#1e3a5f] text-blue-400'
                      : 'text-[#444] hover:bg-[#1a1a1a] hover:text-[#888]'}`}
                  onClick={() => handleModeChange(m.value)}
                  title={m.title}
                >
                  {m.label}
                </button>
              ))}
            </span>

            {/* Push notification bell */}
            {pushState !== 'unsupported' && (
              <button
                className={`bg-transparent border-none cursor-pointer text-base leading-none transition-colors px-1
                  ${pushState === 'granted' ? 'text-blue-400 hover:text-blue-300'
                    : pushState === 'denied'  ? 'text-[#444] cursor-not-allowed'
                    : pushState === 'loading' ? 'text-[#444]'
                    : 'text-[#444] hover:text-[#888]'}`}
                onClick={() => {
                  if (pushState === 'granted') pushUnsubscribe()
                  else if (pushState === 'default') pushSubscribe()
                }}
                title={
                  pushState === 'granted' ? 'Notifications on — click to disable'
                    : pushState === 'denied'  ? 'Notifications blocked in browser settings'
                    : pushState === 'loading' ? 'Loading…'
                    : 'Enable push notifications'
                }
                disabled={pushState === 'loading' || pushState === 'denied'}
              >
                {pushState === 'granted' ? '🔔' : '🔕'}
              </button>
            )}
          </span>
        </div>

        {promptOpen && (
          <div className="px-3 pb-3 flex flex-col gap-2">
            <textarea
              className="bg-[#0d0d0d] border border-[#2a2a2a] focus:border-blue-600 rounded-md text-[#e8e8e8] text-base font-[inherit] leading-relaxed px-2.5 py-2 resize-y outline-none w-full"
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder="Instructions sent to Claude before every message in this session…"
              rows={4}
              autoFocus
            />
            <div className="flex gap-1.5">
              <button
                className="bg-blue-600 hover:bg-blue-500 border-none rounded text-white cursor-pointer text-xs px-3 py-1.5 transition-colors"
                onClick={handlePromptSave}
              >
                Save
              </button>
              <button
                className="bg-transparent border border-[#2a2a2a] hover:border-[#444] hover:text-[#aaa] rounded text-[#666] cursor-pointer text-xs px-2.5 py-1.5 transition-colors"
                onClick={() => { setPromptDraft(systemPrompt ?? ''); setPromptOpen(false) }}
              >
                Cancel
              </button>
              {systemPrompt && (
                <button
                  className="bg-transparent border border-[#2a2a2a] hover:text-red-500 hover:border-red-500/40 rounded text-[#555] cursor-pointer text-xs px-2.5 py-1.5 ml-auto transition-colors"
                  onClick={async () => { await updateSystemPrompt(sessionId, null); onSystemPromptChange?.(null); setPromptDraft(''); setPromptOpen(false) }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8 flex flex-col gap-5">
        {hasMore && (
          <div className="flex justify-center flex-shrink-0">
            <button
              onClick={loadOlder}
              disabled={loadingOlder}
              className="text-xs text-[#555] hover:text-[#888] border border-[#2a2a2a] hover:border-[#444] rounded-full px-3 py-1.5 bg-transparent cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
            >
              {loadingOlder ? 'Loading…' : '↑ Load older messages'}
            </button>
          </div>
        )}
        {messages.length === 0 && !hasMore && (
          <div className="flex items-center justify-center flex-1 text-[#444] text-sm">
            <p>Start a conversation with Claude.</p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            role={m.role}
            content={m.content}
            streaming={m.streaming}
            errorCode={m.errorCode}
            toolUses={m.toolUses}
          />
        ))}
        {streaming && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 flex-wrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#555] tool-pulse flex-shrink-0" />
            <span className="w-1.5 h-1.5 rounded-full bg-[#555] tool-pulse tool-pulse-2 flex-shrink-0" />
            <span className="w-1.5 h-1.5 rounded-full bg-[#555] tool-pulse tool-pulse-3 flex-shrink-0" />
            {/* Assembled tool calls with detail (muted, completed) */}
            {streamingToolUses.map((call, i) => (
              <span key={i} className="text-[11px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-[#555] max-w-[280px] truncate">
                <span className="text-[#777]">{call.name}</span>
                {call.detail && <span className="text-[#444]">: {call.detail}</span>}
              </span>
            ))}
            {/* Currently streaming tool input (blue, active) */}
            {streamingTool && (
              <span className="text-[11px] px-1.5 py-0.5 rounded border border-blue-500/40 bg-blue-500/10 text-blue-400">
                {streamingTool}
              </span>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <MessageInput
        sessionId={sessionId}
        onSend={handleSend}
        onStop={() => {
          streamingFromSendRef.current = false
          // Tell the server to kill the Claude subprocess before aborting the SSE fetch.
          stopChat(sessionId)
          cancelRef.current?.()
          setMessages((prev) =>
            prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
          )
          setStreamingTool(null)
          setStreamingToolUses([])
          setStreaming(false)
        }}
        disabled={streaming}
      />
    </div>
  )
}
