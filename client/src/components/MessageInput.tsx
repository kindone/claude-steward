import { useRef, useEffect, useState, type KeyboardEvent } from 'react'

type Props = {
  sessionId: string
  onSend: (message: string) => void
  onStop?: () => void
  disabled: boolean
}

function draftKey(sessionId: string) {
  return `steward:draft:${sessionId}`
}

type DraftState = 'idle' | 'typing' | 'saved'

export function MessageInput({ sessionId, onSend, onStop, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [draftState, setDraftState] = useState<DraftState>('idle')

  // Restore draft on mount
  useEffect(() => {
    if (!textareaRef.current) return
    try {
      const saved = localStorage.getItem(draftKey(sessionId))
      if (saved) {
        textareaRef.current.value = saved
        setDraftState('saved')
      } else {
        setDraftState('idle')
      }
    } catch { /* ignore */ }
  }, [sessionId])

  // Flush draft immediately on tab close — debounce alone won't fire in time
  useEffect(() => {
    function flushDraft() {
      try {
        const value = textareaRef.current?.value ?? ''
        if (value) {
          localStorage.setItem(draftKey(sessionId), value)
        } else {
          localStorage.removeItem(draftKey(sessionId))
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('beforeunload', flushDraft)
    return () => window.removeEventListener('beforeunload', flushDraft)
  }, [sessionId])

  function handleInput() {
    setDraftState('typing')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      try {
        const value = textareaRef.current?.value ?? ''
        if (value) {
          localStorage.setItem(draftKey(sessionId), value)
          setDraftState('saved')
        } else {
          localStorage.removeItem(draftKey(sessionId))
          setDraftState('idle')
        }
      } catch { /* ignore */ }
    }, 400)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function submit() {
    const value = textareaRef.current?.value.trim()
    if (!value || disabled) return
    onSend(value)
    if (textareaRef.current) textareaRef.current.value = ''
    try { localStorage.removeItem(draftKey(sessionId)) } catch { /* ignore */ }
    setDraftState('idle')
  }

  return (
    <div className="flex gap-2.5 px-4 py-3 md:px-6 md:py-4 border-t border-[#1f1f1f] bg-[#0d0d0d]">
      <textarea
        ref={textareaRef}
        className={`flex-1 bg-[#1a1a1a] text-[#e8e8e8] border rounded-[10px] px-3.5 py-2.5 text-base font-[inherit] leading-relaxed
          resize-none outline-none transition-colors disabled:opacity-50
          ${draftState === 'typing' ? 'border-amber-500/50' : draftState === 'saved' ? 'border-green-600/50' : 'border-[#2a2a2a] focus:border-blue-600'}`}
        placeholder="Message Claude… (Enter to send, Shift+Enter for newline)"
        rows={3}
        disabled={disabled}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
      />
      {disabled ? (
        <button
          className="bg-[#7f1d1d] hover:bg-[#991b1b] text-red-300 border-none px-5 rounded-[10px]
            cursor-pointer text-sm font-medium whitespace-nowrap flex-shrink-0 min-h-[44px] transition-colors"
          onClick={onStop}
        >
          Stop
        </button>
      ) : (
        <button
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-[#1e2a3a] disabled:text-[#555] disabled:cursor-not-allowed
            text-white border-none px-5 rounded-[10px] cursor-pointer text-sm font-medium
            whitespace-nowrap self-end min-h-[44px] transition-colors"
          onClick={submit}
        >
          Send
        </button>
      )}
    </div>
  )
}
