import { useCallback, useEffect, useRef, useState } from 'react'
import type { Artifact } from '../lib/api'
import { ArtifactEditor } from './ArtifactEditor'

export interface OpenArtifact {
  artifact: Artifact
  content: string
  minimized: boolean
}

interface Props {
  openArtifacts: OpenArtifact[]
  activeArtifactId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onMinimize: (id: string) => void
  onRestore: (id: string) => void
  onContentChange: (id: string, newContent: string) => void
  onSave: (id: string) => void
}

const PANEL_WIDTH_KEY = 'steward:artifactPanelWidth'
const DEFAULT_WIDTH = 420
const MIN_WIDTH = 280

function readStoredWidth(): number {
  const maxWidth = typeof window !== 'undefined'
    ? Math.floor(window.innerWidth * 0.95)
    : DEFAULT_WIDTH
  try {
    const raw = localStorage.getItem(PANEL_WIDTH_KEY)
    if (raw) {
      const n = parseInt(raw, 10)
      if (!isNaN(n)) return Math.min(n, maxWidth)
    }
  } catch { /* ignore */ }
  return Math.min(DEFAULT_WIDTH, maxWidth)
}

export function ArtifactFloat({
  openArtifacts,
  activeArtifactId,
  onActivate,
  onClose,
  onMinimize,
  onRestore,
  onContentChange,
  onSave,
}: Props) {
  const [panelWidth, setPanelWidth] = useState(readStoredWidth)
  const [isDragging, setIsDragging] = useState(false)

  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const nonMinimized = openArtifacts.filter((a) => !a.minimized)
  const minimized = openArtifacts.filter((a) => a.minimized)
  const hasPanel = nonMinimized.length > 0

  // Ensure active artifact is a non-minimized one
  const activeEntry = nonMinimized.find((a) => a.artifact.id === activeArtifactId)
    ?? nonMinimized[0]
  const activeId = activeEntry?.artifact.id ?? null

  // ── Resize handle ─────────────────────────────────────────────────────────────

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartRef.current = { startX: e.clientX, startWidth: panelWidth }
    setIsDragging(true)

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragStartRef.current) return
      const maxWidth = Math.floor(window.innerWidth * 0.7)
      const newWidth = Math.max(
        MIN_WIDTH,
        Math.min(maxWidth, dragStartRef.current.startWidth - (ev.clientX - dragStartRef.current.startX))
      )
      setPanelWidth(newWidth)
    }

    const onMouseUp = () => {
      setIsDragging(false)
      dragStartRef.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      // Persist
      try {
        localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth))
      } catch { /* ignore */ }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [panelWidth])

  // Persist width on change (also covers mouseup path above)
  useEffect(() => {
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth))
    } catch { /* ignore */ }
  }, [panelWidth])

  // ── Minimized pills ───────────────────────────────────────────────────────────

  const minimizedPills = minimized.map((entry, idx) => (
    <button
      key={entry.artifact.id}
      onClick={() => onRestore(entry.artifact.id)}
      title={`Restore: ${entry.artifact.name}`}
      style={{
        position: 'fixed',
        right: 0,
        bottom: idx * 44 + 8,
        width: 32,
        height: 120,
        background: '#1a1a1a',
        border: '1px solid #2a2a2a',
        borderRight: 'none',
        borderRadius: '6px 0 0 6px',
        cursor: 'pointer',
        writingMode: 'vertical-rl',
        textOrientation: 'mixed',
        fontSize: 11,
        color: '#888',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        padding: '4px 8px',
        zIndex: 199,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {entry.artifact.name}
    </button>
  ))

  // ── Main panel ────────────────────────────────────────────────────────────────

  if (!hasPanel) {
    return <>{minimizedPills}</>
  }

  return (
    <>
      {/* Main panel */}
      <div
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          height: '100dvh',
          width: panelWidth,
          zIndex: 200,
          background: '#111',
          borderLeft: '1px solid #1f1f1f',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Resize handle */}
        <div
          onMouseDown={handleResizeMouseDown}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 6,
            height: '100%',
            cursor: 'ew-resize',
            background: isDragging
              ? 'rgba(99,102,241,0.6)'
              : undefined,
            zIndex: 1,
          }}
          onMouseEnter={(e) => {
            if (!isDragging) {
              (e.currentTarget as HTMLDivElement).style.background = 'rgba(99,102,241,0.3)'
            }
          }}
          onMouseLeave={(e) => {
            if (!isDragging) {
              (e.currentTarget as HTMLDivElement).style.background = ''
            }
          }}
        />

        {/* Tab bar (multiple non-minimized artifacts) */}
        {nonMinimized.length > 1 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              gap: 4,
              padding: '4px 8px 0 8px',
              flexShrink: 0,
              overflowX: 'auto',
              borderBottom: '1px solid #1f1f1f',
            }}
          >
            {nonMinimized.map((entry) => {
              const isActive = entry.artifact.id === activeId
              return (
                <div
                  key={entry.artifact.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    borderRadius: '6px 6px 0 0',
                    background: isActive ? '#1a1a1a' : 'transparent',
                    border: isActive ? '1px solid #2a2a2a' : '1px solid transparent',
                    borderBottom: isActive ? '1px solid #1a1a1a' : '1px solid transparent',
                    cursor: 'pointer',
                    flexShrink: 0,
                    maxWidth: 140,
                  }}
                  onClick={() => onActivate(entry.artifact.id)}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: isActive ? '#ccc' : '#666',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 100,
                    }}
                    title={entry.artifact.name}
                  >
                    {entry.artifact.name}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onMinimize(entry.artifact.id) }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#555',
                      fontSize: 11,
                      padding: 0,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                    title="Minimize"
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Single artifact header (when only one open) */}
        {nonMinimized.length === 1 && activeEntry && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              height: 40,
              padding: '0 8px 0 14px',
              borderBottom: '1px solid #1f1f1f',
              flexShrink: 0,
            }}
          >
            <span style={{ flex: 1, fontSize: 12, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeEntry.artifact.name}
            </span>
            <button
              onClick={() => onMinimize(activeEntry.artifact.id)}
              title="Minimize"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: 14, padding: '0 4px' }}
            >
              −
            </button>
            <button
              onClick={() => onClose(activeEntry.artifact.id)}
              title="Close"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: 14, padding: '0 4px' }}
            >
              ×
            </button>
          </div>
        )}

        {/* Content area — paddingLeft clears the 6px resize handle */}
        {activeEntry && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', paddingLeft: 6 }}>
            <ArtifactEditor
              artifact={activeEntry.artifact}
              content={activeEntry.content}
              onChange={(newContent) => onContentChange(activeEntry.artifact.id, newContent)}
              onSave={() => onSave(activeEntry.artifact.id)}
            />
          </div>
        )}
      </div>

      {/* Minimized pills */}
      {minimizedPills}
    </>
  )
}
