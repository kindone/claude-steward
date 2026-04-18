import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { createArtifact, type Artifact, type ArtifactType } from '../lib/api'

interface Props {
  projectId: string
  sessionId: string
  content: string
  defaultType: ArtifactType
  defaultName?: string
  anchorEl: HTMLElement
  onClose: () => void
  onSaved: (artifact: Artifact) => void
}

type Status = 'idle' | 'saving' | 'saved' | 'error'

export function SaveAsArtifactDialog({
  projectId,
  sessionId,
  content,
  defaultType,
  defaultName = '',
  anchorEl,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState(defaultName)
  const [type, setType] = useState<ArtifactType>(defaultType)
  const [language, setLanguage] = useState('')
  const [format, setFormat] = useState<'json' | 'csv'>('json')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const isMobile = window.innerWidth < 640

  // ── Popover positioning (desktop only) ───────────────────────────────────────
  const rect = anchorEl.getBoundingClientRect()
  const estimatedHeight = 280
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

  // Close on outside click (desktop)
  useEffect(() => {
    if (isMobile) return
    const handler = (e: MouseEvent) => {
      if (
        dialogRef.current &&
        !dialogRef.current.contains(e.target as Node) &&
        !anchorEl.contains(e.target as Node)
      ) {
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
    const safeName = name.trim()
    if (!safeName) {
      setErrorMsg('Name is required')
      return
    }

    setStatus('saving')
    setErrorMsg(null)

    const metadata: Record<string, string> = {}
    if (type === 'code' && language.trim()) metadata.language = language.trim()
    if (type === 'data') metadata.format = format

    try {
      const artifact = await createArtifact(projectId, {
        name: safeName,
        type,
        content,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        created_from_session: sessionId,
      })

      setStatus('saved')
      onSaved(artifact)

      setTimeout(() => {
        onClose()
      }, 1200)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const inner = (
    <div
      ref={dialogRef}
      className={
        isMobile
          ? 'bg-app-bg-raised border-t border-app-border-2 rounded-t-2xl shadow-2xl text-xs w-full'
          : 'bg-app-bg-raised border border-app-border-2 rounded-lg shadow-xl text-xs'
      }
      style={isMobile ? {} : popoverStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {status === 'saved' ? (
        <div className="px-4 py-4 flex items-start gap-2 text-green-400">
          <span className="text-base leading-none mt-px">✓</span>
          <div className="font-medium">Artifact saved</div>
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
            <span className="text-app-text-4 font-medium text-sm">Save as Artifact</span>
            <button
              onClick={onClose}
              className="text-app-text-7 hover:text-app-text-4 cursor-pointer leading-none p-1 -mr-1 text-base"
            >
              ✕
            </button>
          </div>

          <div className={`px-4 flex flex-col gap-3 ${isMobile ? 'py-4 pb-8' : 'py-3'}`}>
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-app-text-6">Name</label>
              <input
                autoFocus={!isMobile}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
                placeholder="my-artifact"
                className="bg-app-bg border border-app-border-2 rounded px-2 py-2 text-app-text-2 text-sm focus:outline-none focus:border-app-border-4"
                disabled={status === 'saving'}
              />
            </div>

            {/* Type */}
            <div className="flex flex-col gap-1.5">
              <label className="text-app-text-6">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ArtifactType)}
                className="bg-app-bg border border-app-border-2 rounded px-2 py-2 text-app-text-2 text-sm focus:outline-none focus:border-app-border-4 cursor-pointer"
                disabled={status === 'saving'}
              >
                <option value="chart">chart</option>
                <option value="report">report</option>
                <option value="data">data</option>
                <option value="code">code</option>
              </select>
            </div>

            {/* Language (code only) */}
            {type === 'code' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-app-text-6">Language</label>
                <input
                  type="text"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="python, javascript…"
                  className="bg-app-bg border border-app-border-2 rounded px-2 py-2 text-app-text-2 text-sm focus:outline-none focus:border-app-border-4"
                  disabled={status === 'saving'}
                />
              </div>
            )}

            {/* Format (data only) */}
            {type === 'data' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-app-text-6">Format</label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as 'json' | 'csv')}
                  className="bg-app-bg border border-app-border-2 rounded px-2 py-2 text-app-text-2 text-sm focus:outline-none focus:border-app-border-4 cursor-pointer"
                  disabled={status === 'saving'}
                >
                  <option value="json">json</option>
                  <option value="csv">csv</option>
                </select>
              </div>
            )}

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
    return createPortal(
      <div className="fixed inset-0 z-50 flex flex-col justify-end">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <div className="relative z-10">{inner}</div>
      </div>,
      document.body
    )
  }

  return createPortal(inner, document.body)
}
