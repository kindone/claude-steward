import { useRef, useEffect, useState, useCallback, type KeyboardEvent } from 'react'
import { uploadFiles, type Artifact } from '../lib/api'

type Props = {
  sessionId: string
  projectId?: string | null
  onSend: (message: string) => void
  onStop?: () => void
  disabled: boolean
  focusTrigger?: number
  artifacts?: Artifact[]
}

function draftKey(sessionId: string) {
  return `steward:draft:${sessionId}`
}

type DraftState = 'idle' | 'typing' | 'saved'

export function MessageInput({ sessionId, projectId, onSend, onStop, disabled, focusTrigger, artifacts }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [draftState, setDraftState] = useState<DraftState>('idle')
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)

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

    // Detect @mention token at cursor
    const ta = textareaRef.current
    if (ta) {
      const before = ta.value.slice(0, ta.selectionStart)
      const m = /(?:^|\s)@([\w-]*)$/.exec(before)
      setMentionQuery(m ? m[1] : null)
      setMentionIndex(0)
    }
  }

  const suggestions = (artifacts ?? [])
    .filter(a => a.name.toLowerCase().includes((mentionQuery ?? '').toLowerCase()))
    .slice(0, 6)

  function insertMention(artifact: Artifact) {
    const ta = textareaRef.current
    if (!ta) return
    const before = ta.value.slice(0, ta.selectionStart)
    const after = ta.value.slice(ta.selectionStart)
    const m = /(?:^|\s)@([\w-]*)$/.exec(before)
    if (!m) return
    const start = ta.selectionStart - m[1].length - 1 // position of '@'
    const newVal = ta.value.slice(0, start) + '@' + artifact.name + ' ' + after
    ta.value = newVal
    const newCursor = start + artifact.name.length + 2
    ta.setSelectionRange(newCursor, newCursor)
    setMentionQuery(null)
    // trigger draft save
    handleInput()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(i => (i + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(i => (i - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(suggestions[mentionIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        return
      }
    }
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
    <div className="border-t border-app-border bg-app-bg">
      {/* Pending file chips */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-2.5 md:px-6">
          {pendingFiles.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 bg-app-bg-card border border-app-border-2 rounded-md px-2 py-1 text-[11px] text-app-text-4">
              <span className="truncate max-w-[120px]">{f.name}</span>
              <span className="text-app-text-4 text-[10px]">({(f.size / 1024).toFixed(0)}K)</span>
              <button
                onClick={() => removeFile(i)}
                className="text-app-text-6 hover:text-app-text-2 bg-transparent border-none cursor-pointer text-xs leading-none ml-0.5 p-0"
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
        <div className="flex-1 min-w-0 relative">
          {/* @mention autocomplete dropdown */}
          {mentionQuery !== null && suggestions.length > 0 && (
            <div className="absolute bottom-full left-0 mb-1 z-50 bg-app-bg-card border border-app-border-2 rounded-lg shadow-xl min-w-[200px] max-w-[320px] overflow-hidden">
              {suggestions.map((a, i) => (
                <button
                  key={a.id}
                  onMouseDown={(e) => { e.preventDefault(); insertMention(a) }}
                  className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors cursor-pointer border-none
                    ${i === mentionIndex ? 'bg-app-border-2 text-app-text' : 'text-app-text-3 hover:bg-app-bg-hover'}`}
                >
                  <span className="flex-1 truncate font-medium">{a.name}</span>
                  <span className={`text-[10px] px-1.5 py-px rounded border flex-shrink-0 ${
                    a.type === 'chart' ? 'text-orange-400 bg-orange-500/10 border-orange-500/20' :
                    a.type === 'report' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20' :
                    a.type === 'data' ? 'text-green-400 bg-green-500/10 border-green-500/20' :
                    'text-purple-400 bg-purple-500/10 border-purple-500/20'
                  }`}>{a.type}</span>
                </button>
              ))}
            </div>
          )}
        <div
          className={`flex items-end gap-1 bg-app-bg-card border rounded-[10px] transition-colors
            ${dragOver ? 'border-blue-500/60 bg-blue-500/5' : draftState === 'typing' ? 'border-amber-500/50' : draftState === 'saved' ? 'border-green-600/50' : 'border-app-border-2 focus-within:border-blue-600'}`}
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
              className="text-app-text-6 hover:text-app-text-4 bg-transparent border-none cursor-pointer px-2 py-2.5 flex-shrink-0 transition-colors disabled:opacity-50 text-sm leading-none"
              title="Attach files"
            >
              📎
            </button>
          )}
          <textarea
            ref={textareaRef}
            className="flex-1 bg-transparent text-app-text px-2.5 py-2.5 text-base font-[inherit] leading-relaxed
              resize-none outline-none border-none disabled:opacity-50"
            placeholder={dragOver ? 'Drop files here…' : 'Message Claude…'}
            rows={3}
            disabled={disabled || uploading}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
          />
        </div>
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
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-app-blue-tint-subtle disabled:text-app-text-6 disabled:cursor-not-allowed
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
