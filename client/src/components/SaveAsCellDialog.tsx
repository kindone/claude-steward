import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import {
  createNotebook,
  listNotebooks,
  saveCell,
  type NotebookInfo,
  type SaveCellResult,
} from '../lib/notebookApi'

interface Props {
  projectId: string
  language: string   // raw fence lang e.g. "python"
  code: string
  anchorEl: HTMLElement
  defaultCellName?: string
  onClose: () => void
  onSaved: (result: SaveCellResult) => void
}

type Status = 'idle' | 'saving' | 'saved' | 'error'

export function SaveAsCellDialog({ projectId, language, code, anchorEl, defaultCellName = 'untitled', onClose, onSaved }: Props) {
  const [notebooks, setNotebooks] = useState<NotebookInfo[]>([])
  const [selectedNotebook, setSelectedNotebook] = useState<string>('__new__')
  const [newNotebookName, setNewNotebookName] = useState('notebook')
  const [cellName, setCellName] = useState(defaultCellName)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const isMobile = window.innerWidth < 640

  // Load notebooks on open
  useEffect(() => {
    listNotebooks(projectId).then((nb) => {
      setNotebooks(nb)
      if (nb.length > 0) setSelectedNotebook(nb[0].name)
    }).catch(() => { /* keep __new__ selected */ })
  }, [projectId])

  // ── Popover positioning (desktop only) ───────────────────────────────────────
  const rect = anchorEl.getBoundingClientRect()
  const estimatedHeight = 240
  const flipUp = !isMobile && rect.bottom + estimatedHeight > window.innerHeight - 16
  const popoverStyle: React.CSSProperties = isMobile ? {} : {
    position: 'fixed',
    right: Math.max(8, window.innerWidth - rect.right),
    ...(flipUp
      ? { bottom: window.innerHeight - rect.top + 4 }
      : { top: rect.bottom + 4 }),
    zIndex: 1000,
    width: 280,
  }

  // Close on outside click (desktop) / backdrop tap handled separately
  useEffect(() => {
    if (isMobile) return
    const handler = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node) && !anchorEl.contains(e.target as Node)) {
        onClose()
      }
    }
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 50)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler) }
  }, [anchorEl, onClose, isMobile])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleSave() {
    const notebookName = selectedNotebook === '__new__' ? newNotebookName.trim() : selectedNotebook
    const safeCellName = cellName.trim()

    if (!notebookName || !/^[a-zA-Z0-9_-]+$/.test(notebookName)) {
      setErrorMsg('Notebook name: alphanumeric, hyphens, underscores only')
      return
    }
    if (!safeCellName || !/^[a-zA-Z0-9_-]+$/.test(safeCellName)) {
      setErrorMsg('Cell name: alphanumeric, hyphens, underscores only')
      return
    }

    setStatus('saving')
    setErrorMsg(null)

    try {
      if (selectedNotebook === '__new__') {
        await createNotebook(projectId, notebookName)
      }

      const result = await saveCell(projectId, notebookName, {
        cellName: safeCellName,
        code,
        language,
      })

      setSavedPath(result.path)
      setStatus('saved')
      onSaved(result)

      setTimeout(onClose, 1800)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const pathPreview = (() => {
    const nb = selectedNotebook === '__new__' ? newNotebookName.trim() : selectedNotebook
    const cn = cellName.trim()
    if (!nb || !cn) return '…'
    return `notebooks/${nb}/cells/NN_${cn}.${langToExt(language)}`
  })()

  const inner = (
    <div
      ref={dialogRef}
      className={isMobile
        ? 'bg-app-bg-raised border-t border-app-border-2 rounded-t-2xl shadow-2xl text-xs w-full'
        : 'bg-app-bg-raised border border-app-border-2 rounded-lg shadow-xl text-xs'}
      style={isMobile ? {} : popoverStyle}
      onClick={e => e.stopPropagation()}
    >
      {status === 'saved' ? (
        <div className="px-4 py-4 flex items-start gap-2 text-green-400">
          <span className="text-base leading-none mt-px">✓</span>
          <div>
            <div className="font-medium">Saved</div>
            <div className="text-app-text-5 mt-0.5 break-all">{savedPath}</div>
          </div>
        </div>
      ) : (
        <>
          {/* Drag handle (mobile only) */}
          {isMobile && (
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-app-border-3" />
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-2.5 pb-2 border-b border-app-bg-overlay">
            <span className="text-app-text-4 font-medium text-sm">Save as Cell</span>
            <button
              onClick={onClose}
              className="text-app-text-7 hover:text-app-text-4 cursor-pointer leading-none p-1 -mr-1 text-base"
            >
              ✕
            </button>
          </div>

          <div className={`px-4 flex flex-col gap-3 ${isMobile ? 'py-4 pb-8' : 'py-3'}`}>
            {/* Notebook selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-app-text-6">Notebook</label>
              <select
                value={selectedNotebook}
                onChange={e => setSelectedNotebook(e.target.value)}
                className="bg-app-bg border border-app-border-2 rounded px-2 py-2 text-app-text-2 text-sm focus:outline-none focus:border-app-border-4 cursor-pointer"
                disabled={status === 'saving'}
              >
                {notebooks.map(nb => (
                  <option key={nb.name} value={nb.name}>{nb.name}</option>
                ))}
                <option value="__new__">+ New notebook…</option>
              </select>
              {selectedNotebook === '__new__' && (
                <input
                  autoFocus={!isMobile}
                  type="text"
                  value={newNotebookName}
                  onChange={e => setNewNotebookName(e.target.value)}
                  placeholder="notebook-name"
                  className="bg-app-bg border border-app-border-2 rounded px-2 py-2 text-app-text-2 text-sm focus:outline-none focus:border-app-border-4"
                  disabled={status === 'saving'}
                />
              )}
            </div>

            {/* Cell name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-app-text-6">Cell name</label>
              <input
                type="text"
                value={cellName}
                onChange={e => setCellName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                placeholder="cell-name"
                className="bg-app-bg border border-app-border-2 rounded px-2 py-2 text-app-text-2 text-sm focus:outline-none focus:border-app-border-4"
                disabled={status === 'saving'}
              />
              <div className="text-app-text-7 text-[11px]">
                → <span className="font-mono text-app-text-6">{pathPreview}</span>
              </div>
            </div>

            {/* Error */}
            {errorMsg && (
              <div className="text-red-400 text-[11px]">{errorMsg}</div>
            )}

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={status === 'saving'}
              className={`w-full bg-app-blue-tint-subtle hover:bg-app-blue-tint-hover border border-app-blue-border text-blue-300 rounded cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-default ${isMobile ? 'py-3 text-base' : 'py-1.5 text-xs'}`}
            >
              {status === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  )

  if (isMobile) {
    // Bottom sheet with backdrop
    return createPortal(
      <div className="fixed inset-0 z-50 flex flex-col justify-end">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60"
          onClick={onClose}
        />
        {/* Sheet */}
        <div className="relative z-10">
          {inner}
        </div>
      </div>,
      document.body
    )
  }

  // Desktop: floating popover
  return createPortal(inner, document.body)
}

/** Mirror of the server-side extension map for the preview label. */
function langToExt(lang: string): string {
  const map: Record<string, string> = {
    python: 'py', python3: 'py', py: 'py',
    javascript: 'js', js: 'js', node: 'js',
    typescript: 'ts', ts: 'ts',
    bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', fish: 'sh',
    cpp: 'cpp', 'c++': 'cpp', cxx: 'cpp', cc: 'cpp',
    r: 'r', sql: 'sql', ruby: 'rb', rb: 'rb', go: 'go', rust: 'rs',
  }
  return map[lang.toLowerCase().trim()] ?? 'txt'
}
