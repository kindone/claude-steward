import { useState, useEffect, useRef } from 'react'
import { sendMessage, getMessages, updateSystemPrompt, updatePermissionMode, type ClaudeErrorCode, type PermissionMode } from '../lib/api'

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
  /** Tool names used while generating this message, in order of first appearance. */
  toolUses?: string[]
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
  const [streaming, setStreaming] = useState(false)
  const [streamingTool, setStreamingTool] = useState<string | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState(systemPrompt ?? '')
  const bottomRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  /** True while we have an active sendMessage() — poll must not overwrite the optimistic assistant bubble. */
  const streamingFromSendRef = useRef(false)
  /** Accumulates unique tool names fired during the current send, in order of first appearance. */
  const toolUsesRef = useRef<string[]>([])
  /** Live copy of toolUsesRef for rendering the streaming indicator. */
  const [streamingToolUses, setStreamingToolUses] = useState<string[]>([])

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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    streamingFromSendRef.current = false
    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let pollCount = 0
    const MAX_POLLS = 60 // 2 minutes at 2s intervals

    function clearPoll() {
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
    }

    async function pollForResponse() {
      if (cancelled || pollCount >= MAX_POLLS) {
        setStreaming(false)
        return
      }
      pollCount++
      try {
        const loaded = await getMessages(sessionId)
        if (cancelled) return
        if (loaded[loaded.length - 1]?.role === 'assistant') {
          setMessages(loaded.map((m) => ({ ...m, streaming: false })))
          setStreaming(false)
          return
        }
        // Don't overwrite messages with DB state while we're streaming from sendMessage() — that would remove the assistant placeholder.
        if (streamingFromSendRef.current) {
          pollTimer = setTimeout(pollForResponse, 2000)
          return
        }
        setMessages(loaded.map((m) => ({ ...m, streaming: false })))
        pollTimer = setTimeout(pollForResponse, 2000)
      } catch {
        setStreaming(false)
      }
    }

    getMessages(sessionId).then((loaded) => {
      if (cancelled) return
      setMessages(loaded.map((m) => ({ ...m, streaming: false })))
      // If last message is a user message with no response yet, Claude may still be processing.
      // Show streaming indicator and poll until the assistant message lands in the DB.
      if (loaded.length > 0 && loaded[loaded.length - 1].role === 'user') {
        setStreaming(true)
        pollTimer = setTimeout(pollForResponse, 2000)
      }
    }).catch(() => {/* session may be new — ignore */})

    return () => {
      cancelled = true
      cancelRef.current?.()
      clearPoll()
    }
  }, [sessionId])

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
        if (toolName && !toolUsesRef.current.includes(toolName)) {
          toolUsesRef.current = [...toolUsesRef.current, toolName]
          setStreamingToolUses([...toolUsesRef.current])
        }
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
      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8 flex flex-col gap-5">
        {messages.length === 0 && (
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
            {streamingToolUses.map((name, i) => (
              <span
                key={i}
                className={`text-xs px-1.5 py-0.5 rounded border transition-colors
                  ${name === streamingTool
                    ? 'text-blue-400 border-blue-500/40 bg-blue-500/10'
                    : 'text-[#666] border-[#2a2a2a]'}`}
              >
                {name}
              </span>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <MessageInput
        onSend={handleSend}
        onStop={() => {
          streamingFromSendRef.current = false
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
