import { useState, useEffect } from 'react'
import { listArtifacts, deleteArtifact, refreshArtifact, updateArtifact, type Artifact, type ArtifactType } from '../lib/api'

interface Props {
  projectId: string
  onOpen: (artifact: Artifact) => void
  refreshTick?: number
}

// ── Type badge ────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<ArtifactType, string> = {
  chart: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  report: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  data: 'text-green-400 bg-green-500/10 border-green-500/20',
  code: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
}

function TypeBadge({ type }: { type: ArtifactType }) {
  return (
    <span
      className={`text-[10px] font-semibold px-1.5 py-px rounded border flex-shrink-0 ${TYPE_COLORS[type]}`}
    >
      {type}
    </span>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRefreshCommand(a: Artifact): string | undefined {
  if (!a.metadata) return undefined
  try { return (JSON.parse(a.metadata) as Record<string, unknown>).refresh_command as string | undefined }
  catch { return undefined }
}

function relativeTime(ts: number): string {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ArtifactPanel({ projectId, onOpen, refreshTick }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    setLoading(true)
    setError(null)
    listArtifacts(projectId)
      .then(setArtifacts)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load artifacts')
        setArtifacts([])
      })
      .finally(() => setLoading(false))
  }, [projectId, refreshTick])

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this artifact? This cannot be undone.')) return
    try {
      await deleteArtifact(id)
      setArtifacts((prev) => prev.filter((a) => a.id !== id))
    } catch (err) {
      console.error('[artifacts] delete failed:', err)
    }
  }

  async function handleRefresh(id: string) {
    setRefreshingIds(prev => new Set(prev).add(id))
    try {
      await refreshArtifact(id)
      // Re-fetch list to update updated_at
      const updated = await listArtifacts(projectId)
      setArtifacts(updated)
    } catch (e) {
      console.error('Refresh failed', e)
    } finally {
      setRefreshingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  async function handleRename(id: string) {
    const newName = renameValue.trim()
    setRenamingId(null)
    if (!newName || newName === artifacts.find(a => a.id === id)?.name) return
    try {
      await updateArtifact(id, { name: newName })
      setArtifacts(prev => prev.map(a => a.id === id ? { ...a, name: newName } : a))
    } catch (e) {
      console.error('Rename failed', e)
    }
  }

  return (
    <div className="px-3 pb-3 flex flex-col gap-2">
      {loading ? (
        <p className="text-[11px] text-[#555]">Loading…</p>
      ) : error ? (
        <p className="text-[11px] text-red-500">{error}</p>
      ) : artifacts.length === 0 ? (
        <p className="text-[11px] text-[#444] italic">
          No artifacts yet — save a code block or ask Claude to create one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {artifacts.map((a) => (
            <li
              key={a.id}
              className="border border-[#2a2a2a] rounded-md px-2.5 py-2 flex flex-col gap-1"
            >
              <div className="flex items-center gap-2">
                <TypeBadge type={a.type} />
                <div className="flex-1 min-w-0 flex flex-col">
                  {renamingId === a.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => void handleRename(a.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void handleRename(a.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      className="flex-1 bg-[#1a1a1a] border border-[#3a3a3a] rounded px-1 text-[12px] text-[#ccc] outline-none min-w-0"
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="text-[12px] font-medium text-[#ccc] truncate cursor-text"
                      title={`${a.name} — click to rename`}
                      onClick={() => { setRenamingId(a.id); setRenameValue(a.name) }}
                    >
                      {a.name}
                    </span>
                  )}
                  <span className="text-[10px] text-[#444]">{relativeTime(a.updated_at)}</span>
                </div>
                {getRefreshCommand(a) && (
                  <button
                    onClick={() => void handleRefresh(a.id)}
                    disabled={refreshingIds.has(a.id)}
                    title="Refresh artifact"
                    className={`text-[#555] hover:text-[#aaa] flex-shrink-0 px-1 flex items-center disabled:opacity-50 ${refreshingIds.has(a.id) ? 'animate-spin' : ''}`}
                  >
                    ↻
                  </button>
                )}
                <button
                  onClick={() => onOpen(a)}
                  title="Open artifact"
                  className="text-[#555] hover:text-[#aaa] flex-shrink-0 px-1 flex items-center"
                >
                  <EyeIcon />
                </button>
                <button
                  onClick={() => handleDelete(a.id)}
                  title="Delete artifact"
                  className="text-[#555] hover:text-red-500 flex-shrink-0 px-1 flex items-center"
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
