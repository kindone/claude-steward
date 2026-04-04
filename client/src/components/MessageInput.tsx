import { useRef, useEffect, useState, useCallback, type KeyboardEvent } from 'react'
import { uploadFiles } from '../lib/api'

type Props = {
  sessionId: string
  projectId?: string | null
  onSend: (message: string) => void
  onStop?: () => void
  disabled: boolean
  focusTrigger?: number
}

function draftKey(sessionId: string) {
  return `steward:draft:${sessionId}`
}

type DraftState = 'idle' | 'typing' | 'saved'

export function MessageInput({ sessionId, projectId, onSend, onStop, disabled, focusTrigger }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [draftState, setDraftState] = useState<DraftState>('idle')

  // Re-focus textarea when streaming ends (focusTrigger increments) or on mount
  useEffect(() => {
    if (focusTrigger === undefined) return
    textareaRef.current?.focus()
  }, [focusTrigger])

  // File attachment state
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((files: FileList | File[]) => {
    const newFiles = Array.from(files)
    setPendingFiles((prev) => [...prev, ...newFiles])
  }, [])

  const removeFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

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

  async function submit() {
    const value = textareaRef.current?.value.trim() ?? ''
    if ((!value && pendingFiles.length === 0) || disabled) return

    let message = value

    // Upload files first if any
    if (pendingFiles.length > 0 && projectId) {
      setUploading(true)
      try {
        const result = await uploadFiles(projectId, pendingFiles, 'uploads')
        const fileRefs = result.uploaded.map((f) => `uploads/${f.name}`).join(', ')
        const fileMsg = result.uploaded.length === 1
          ? `I've uploaded a file at \`uploads/${result.uploaded[0].name}\`. Please read and analyze it.`
          : `I've uploaded ${result.uploaded.length} files (${fileRefs}). Please read and analyze them.`
        message = value ? `${value}\n\n${fileMsg}` : fileMsg
        setPendingFiles([])
      } catch (err) {
        alert(`Upload failed: ${(err as Error).message}`)
        setUploading(false)
        return
      } finally {
        setUploading(false)
      }
    }

    if (!message) return
    onSend(message)
    if (textareaRef.current) {
      textareaRef.current.value = ''
      textareaRef.current.focus()
    }
    try { localStorage.removeItem(draftKey(sessionId)) } catch { /* ignore */ }
    setDraftState('idle')
  }

  return (
    <div className="border-t border-[#1f1f1f] bg-[#0d0d0d]">
      {/* Pending file chips */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-2.5 md:px-6">
          {pendingFiles.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-2 py-1 text-[11px] text-[#888]">
              <span className="truncate max-w-[120px]">{f.name}</span>
              <span className="text-[#888] text-[10px]">({(f.size / 1024).toFixed(0)}K)</span>
              <button
                onClick={() => removeFile(i)}
                className="text-[#555] hover:text-[#ccc] bg-transparent border-none cursor-pointer text-xs leading-none ml-0.5 p-0"
              >×</button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2.5 px-4 py-3 md:px-6 md:py-4">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files) }}
        />
        <div
          className={`flex-1 min-w-0 flex items-end gap-1 bg-[#1a1a1a] border rounded-[10px] transition-colors
            ${dragOver ? 'border-blue-500/60 bg-blue-500/5' : draftState === 'typing' ? 'border-amber-500/50' : draftState === 'saved' ? 'border-green-600/50' : 'border-[#2a2a2a] focus-within:border-blue-600'}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
          }}
        >
          {/* Attach button */}
          {projectId && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || uploading}
              className="text-[#555] hover:text-[#888] bg-transparent border-none cursor-pointer px-2 py-2.5 flex-shrink-0 transition-colors disabled:opacity-50 text-sm leading-none"
              title="Attach files"
            >
              📎
            </button>
          )}
          <textarea
            ref={textareaRef}
            className="flex-1 bg-transparent text-[#e8e8e8] px-2.5 py-2.5 text-base font-[inherit] leading-relaxed
              resize-none outline-none border-none disabled:opacity-50"
            placeholder={dragOver ? 'Drop files here…' : 'Message Claude…'}
            rows={3}
            disabled={disabled || uploading}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
          />
        </div>
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
              whitespace-nowrap flex-shrink-0 self-end min-h-[44px] transition-colors"
            disabled={uploading}
            onClick={() => void submit()}
          >
            {uploading ? '↑…' : 'Send'}
          </button>
        )}
      </div>
    </div>
  )
}
