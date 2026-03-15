import { useRef, type KeyboardEvent } from 'react'

type Props = {
  onSend: (message: string) => void
  onStop?: () => void
  disabled: boolean
}

export function MessageInput({ onSend, onStop, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
  }

  return (
    <div className="flex gap-2.5 px-4 py-3 md:px-6 md:py-4 border-t border-[#1f1f1f] bg-[#0d0d0d]">
      <textarea
        ref={textareaRef}
        className="flex-1 bg-[#1a1a1a] text-[#e8e8e8] border border-[#2a2a2a] focus:border-blue-600
          rounded-[10px] px-3.5 py-2.5 text-base font-[inherit] leading-relaxed
          resize-none outline-none transition-colors disabled:opacity-50"
        placeholder="Message Claude… (Enter to send, Shift+Enter for newline)"
        rows={3}
        disabled={disabled}
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
