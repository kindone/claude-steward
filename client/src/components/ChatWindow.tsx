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
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState(systemPrompt ?? '')
  const bottomRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<(() => void) | null>(null)

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
      onActivity,
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
      onError: (errorMsg, code) => {
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
    <div className="chat-window">
      {/* Session header bar: system prompt toggle + permission mode selector */}
      <div className="chat-window__prompt-bar">
        <div className="chat-window__header-row">
          <button
            className={`chat-window__prompt-toggle${systemPrompt ? ' chat-window__prompt-toggle--active' : ''}`}
            onClick={() => setPromptOpen((o) => !o)}
            title="System prompt"
          >
            {systemPrompt ? '⚙ Prompt set' : '⚙ Prompt'}
          </button>
          <span className="chat-window__mode-seg">
            {MODES.map((m) => (
              <button
                key={m.value}
                className={`chat-window__mode-btn${permissionMode === m.value ? ' chat-window__mode-btn--active' : ''}`}
                onClick={() => handleModeChange(m.value)}
                title={m.title}
              >
                {m.label}
              </button>
            ))}
          </span>
        </div>
        {promptOpen && (
          <div className="chat-window__prompt-editor">
            <textarea
              className="chat-window__prompt-textarea"
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder="Instructions sent to Claude before every message in this session…"
              rows={4}
              autoFocus
            />
            <div className="chat-window__prompt-actions">
              <button className="chat-window__prompt-save" onClick={handlePromptSave}>Save</button>
              <button className="chat-window__prompt-cancel" onClick={() => { setPromptDraft(systemPrompt ?? ''); setPromptOpen(false) }}>Cancel</button>
              {systemPrompt && (
                <button className="chat-window__prompt-clear" onClick={async () => { await updateSystemPrompt(sessionId, null); onSystemPromptChange?.(null); setPromptDraft(''); setPromptOpen(false) }}>Clear</button>
              )}
            </div>
          </div>
        )}
      </div>

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
            errorCode={m.errorCode}
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
