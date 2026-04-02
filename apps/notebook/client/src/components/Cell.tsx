import { useState, useRef, useEffect, useCallback } from 'react'
import type { Cell as CellType, Language, OutputLine, CompileResult } from '../types'
import { streamKernelRun, updateCell, deleteCell } from '../api'

const LANG_LABELS: Record<Language, string> = {
  python: 'Python',
  node: 'Node.js',
  bash: 'Bash',
  cpp: 'C++',
}

const LANG_COLORS: Record<Language, string> = {
  python: 'text-blue-400',
  node: 'text-green-400',
  bash: 'text-yellow-400',
  cpp: 'text-orange-400',
}

interface Props {
  cell: CellType
  onUpdate: (cell: CellType) => void
  onDelete: (id: string) => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  isRunningByAI?: boolean
}

// Minimal markdown renderer — handles headings, bold, italic, code, links, lists
function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold mt-4 mb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-black/30 px-1 rounded text-xs font-mono">$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-[var(--color-accent)] underline" target="_blank">$1</a>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
    .replace(/\n\n/g, '</p><p class="mb-2">')
    .replace(/\n/g, '<br/>')
}

export function Cell({ cell, onUpdate, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown, isRunningByAI }: Props) {
  const [source, setSource] = useState(cell.source)
  const [isDirty, setIsDirty] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [outputs, setOutputs] = useState<OutputLine[]>([])
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [mdPreview, setMdPreview] = useState(cell.type === 'markdown')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Sync external updates (from file watcher / Claude edits)
  useEffect(() => {
    if (cell.source !== source && !isDirty) {
      setSource(cell.source)
    }
  }, [cell.source])

  // Run All: listen for imperative run trigger from parent
  useEffect(() => {
    const handler = (e: Event) => {
      const { cellId, onDone } = (e as CustomEvent<{ cellId: string; onDone: () => void }>).detail
      if (cellId !== cell.id) return
      if (cell.type === 'markdown') { onDone(); return }

      setIsRunning(true)
      setOutputs([])
      setCompileResult(null)

      const ac = new AbortController()
      abortRef.current = ac

      streamKernelRun(
        cell.id,
        (line) => setOutputs(prev => [...prev, { text: line }]),
        (ok, output) => setCompileResult({ ok, output }),
        () => { setIsRunning(false); abortRef.current = null; onDone() },
        (msg) => {
          setOutputs(prev => [...prev, { text: msg, isError: true }])
          setIsRunning(false)
          abortRef.current = null
          onDone()
        },
        ac.signal,
      )
    }
    window.addEventListener('notebook:run-cell', handler)
    return () => window.removeEventListener('notebook:run-cell', handler)
  }, [cell.id, cell.type])

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [source, mdPreview])

  const handleSourceChange = (val: string) => {
    setSource(val)
    setIsDirty(true)
  }

  const handleSave = useCallback(async () => {
    if (!isDirty) return
    const updated = await updateCell(cell.id, { source })
    onUpdate(updated)
    setIsDirty(false)
  }, [cell.id, source, isDirty, onUpdate])

  const handleRun = async () => {
    if (isRunning) {
      abortRef.current?.abort()
      return
    }

    if (isDirty) await handleSave()

    setIsRunning(true)
    setOutputs([])
    setCompileResult(null)

    const ac = new AbortController()
    abortRef.current = ac

    streamKernelRun(
      cell.id,
      (line) => setOutputs(prev => [...prev, { text: line }]),
      (ok, output) => setCompileResult({ ok, output }),
      () => { setIsRunning(false); abortRef.current = null },
      (msg) => {
        setOutputs(prev => [...prev, { text: msg, isError: true }])
        setIsRunning(false)
        abortRef.current = null
      },
      ac.signal,
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = textareaRef.current!
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newVal = source.substring(0, start) + '  ' + source.substring(end)
      setSource(newVal)
      setIsDirty(true)
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + 2 }, 0)
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleRun()
    }
  }

  const isMarkdown = cell.type === 'markdown'
  const highlight = isRunningByAI ? 'ring-1 ring-purple-500' : ''

  return (
    <div className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden ${highlight}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-black/20">

        {/* Reorder buttons */}
        <div className="flex flex-col -my-0.5 mr-0.5">
          <button
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="text-[var(--color-muted)] hover:text-white disabled:opacity-20 disabled:cursor-not-allowed leading-none text-[10px] px-0.5"
            title="Move up"
          >▲</button>
          <button
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="text-[var(--color-muted)] hover:text-white disabled:opacity-20 disabled:cursor-not-allowed leading-none text-[10px] px-0.5"
            title="Move down"
          >▼</button>
        </div>

        {isMarkdown ? (
          <span className="text-xs font-medium text-purple-400">Markdown</span>
        ) : (
          <span className={`text-xs font-medium ${LANG_COLORS[cell.language]}`}>
            {LANG_LABELS[cell.language]}
          </span>
        )}
        <span className="text-xs text-[var(--color-muted)]">#{cell.position}</span>
        {isDirty && <span className="text-xs text-yellow-500">●</span>}
        {isRunningByAI && <span className="text-xs text-purple-400 animate-pulse">AI running…</span>}

        <div className="ml-auto flex items-center gap-1">
          {isMarkdown && (
            <button
              onClick={() => { if (isDirty) handleSave(); setMdPreview(!mdPreview) }}
              className="text-xs px-2 py-0.5 rounded text-[var(--color-muted)] hover:text-white hover:bg-white/10"
            >
              {mdPreview ? 'Edit' : 'Preview'}
            </button>
          )}
          {isDirty && (
            <button
              onClick={handleSave}
              className="text-xs px-2 py-0.5 rounded text-[var(--color-muted)] hover:text-white hover:bg-white/10"
            >
              Save
            </button>
          )}
          {!isMarkdown && (
            <button
              onClick={handleRun}
              className={`text-xs px-2.5 py-0.5 rounded font-medium transition-colors ${
                isRunning
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30'
              }`}
            >
              {isRunning ? '■ Stop' : '▶ Run'}
            </button>
          )}
          <button
            onClick={() => setShowDelete(!showDelete)}
            className="text-xs px-1.5 py-0.5 rounded text-[var(--color-muted)] hover:text-red-400 hover:bg-red-500/10"
          >
            ✕
          </button>
        </div>
      </div>

      {showDelete && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border-b border-[var(--color-border)]">
          <span className="text-xs text-red-400">Delete this cell?</span>
          <button onClick={() => onDelete(cell.id)} className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30">Delete</button>
          <button onClick={() => setShowDelete(false)} className="text-xs px-2 py-0.5 rounded text-[var(--color-muted)] hover:bg-white/10">Cancel</button>
        </div>
      )}

      {/* Markdown preview */}
      {isMarkdown && mdPreview ? (
        <div
          className="p-3 text-sm text-[var(--color-text)] leading-relaxed min-h-[60px] cursor-text prose-invert"
          onClick={() => setMdPreview(false)}
          dangerouslySetInnerHTML={{ __html: source ? `<p class="mb-2">${renderMarkdown(source)}</p>` : '<span class="text-[var(--color-muted)] text-xs">Empty — click to edit</span>' }}
        />
      ) : (
        <textarea
          ref={textareaRef}
          value={source}
          onChange={(e) => handleSourceChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          spellCheck={false}
          placeholder={isMarkdown ? '# Markdown content…' : `# ${LANG_LABELS[cell.language]} code`}
          className="w-full bg-transparent text-[var(--color-text)] p-3 resize-none outline-none leading-relaxed min-h-[80px]"
          style={{ height: 'auto' }}
        />
      )}

      {/* C++ compile result */}
      {compileResult && (
        <div className={`px-3 py-2 border-t border-[var(--color-border)] text-xs ${
          compileResult.ok ? 'text-green-400 bg-green-500/5' : 'text-red-400 bg-red-500/5'
        }`}>
          <div className="font-medium mb-1">{compileResult.ok ? '✓ Compiled' : '✗ Compile error'}</div>
          {compileResult.output && (
            <pre className="whitespace-pre-wrap opacity-80">{compileResult.output}</pre>
          )}
        </div>
      )}

      {/* Output */}
      {outputs.length > 0 && (
        <div className="border-t border-[var(--color-border)] bg-black/30 p-3">
          <pre className="text-xs leading-relaxed whitespace-pre-wrap">
            {outputs.map((o, i) => (
              <span key={i} className={o.isError ? 'text-red-400' : 'text-gray-300'}>
                {o.text}{'\n'}
              </span>
            ))}
          </pre>
        </div>
      )}

      {isRunning && outputs.length === 0 && (
        <div className="border-t border-[var(--color-border)] px-3 py-2">
          <span className="text-xs text-[var(--color-muted)] animate-pulse">Running…</span>
        </div>
      )}
    </div>
  )
}
