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
    <div className="input-bar">
      <textarea
        ref={textareaRef}
        className="input-bar__textarea"
        placeholder="Message Claude... (Enter to send, Shift+Enter for newline)"
        rows={3}
        disabled={disabled}
        onKeyDown={handleKeyDown}
      />
      {disabled ? (
        <button className="input-bar__stop" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button className="input-bar__send" onClick={submit}>
          Send
        </button>
      )}
    </div>
  )
}
