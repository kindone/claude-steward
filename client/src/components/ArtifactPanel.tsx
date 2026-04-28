import { useState, useEffect, useRef } from 'react'
import {
  listArtifacts, deleteArtifact, refreshArtifact, updateArtifact,
  listTopics, createTopic, updateTopic, deleteTopic, moveArtifactToTopic,
  type Artifact, type ArtifactType, type Topic,
} from '../lib/api'

interface Props {
  projectId: string
  onOpen: (artifact: Artifact) => void
  refreshTick?: number
}

// ── Type badge ────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<ArtifactType, string> = {
  chart:  'text-orange-400 bg-orange-500/10 border-orange-500/20',
  report: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  data:   'text-green-400 bg-green-500/10 border-green-500/20',
  code:   'text-purple-400 bg-purple-500/10 border-purple-500/20',
  pikchr: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  html:   'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  mdart:  'text-teal-400 bg-teal-500/10 border-teal-500/20',
}

function TypeBadge({ type }: { type: ArtifactType }) {
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-px rounded border flex-shrink-0 ${TYPE_COLORS[type]}`}>
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

function FolderMoveIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
      <polyline points="9 18 15 12 9 6"/>
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

const COLLAPSED_KEY = (projectId: string) => `art-topics-collapsed:${projectId}`

function loadCollapsed(projectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY(projectId))
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch { return new Set() }
}

function saveCollapsed(projectId: string, collapsed: Set<string>) {
  try { localStorage.setItem(COLLAPSED_KEY(projectId), JSON.stringify([...collapsed])) }
  catch { /* ignore */ }
}

// ── Move dropdown ─────────────────────────────────────────────────────────────

interface MoveDropdownProps {
  artifact: Artifact
  topics: Topic[]
  onMove: (artifactId: string, topicId: string | null) => void
  onClose: () => void
}

function MoveDropdown({ artifact, topics, onMove, onClose }: MoveDropdownProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 bg-app-bg-card border border-app-border-2 rounded-md shadow-lg min-w-[140px] py-1 text-[12px]"
    >
      <div className="px-2 py-1 text-[10px] text-app-text-7 font-semibold uppercase tracking-wide">Move to</div>
      <button
        onClick={() => { onMove(artifact.id, null); onClose() }}
        className={`w-full text-left px-3 py-1.5 hover:bg-app-bg-hover flex items-center gap-1.5 ${artifact.topic_id === null ? 'text-app-text-3 font-medium' : 'text-app-text-5'}`}
      >
        / root
        {artifact.topic_id === null && <span className="ml-auto text-[9px] text-app-text-6">current</span>}
      </button>
      {topics.map(t => (
        <button
          key={t.id}
          onClick={() => { onMove(artifact.id, t.id); onClose() }}
          className={`w-full text-left px-3 py-1.5 hover:bg-app-bg-hover flex items-center gap-1.5 truncate ${artifact.topic_id === t.id ? 'text-app-text-3 font-medium' : 'text-app-text-5'}`}
        >
          {t.name}
          {artifact.topic_id === t.id && <span className="ml-auto text-[9px] text-app-text-6 flex-shrink-0">current</span>}
        </button>
      ))}
    </div>
  )
}

// ── Artifact row ──────────────────────────────────────────────────────────────

interface ArtifactRowProps {
  artifact: Artifact
  topics: Topic[]
  refreshingIds: Set<string>
  renamingId: string | null
  renameValue: string
  movingId: string | null
  onOpen: (a: Artifact) => void
  onDelete: (id: string) => void
  onRefresh: (id: string) => void
  onStartRename: (id: string, name: string) => void
  onRenameChange: (v: string) => void
  onRenameCommit: (id: string) => void
  onRenameCancel: () => void
  onToggleMove: (id: string) => void
  onMove: (artifactId: string, topicId: string | null) => void
  onCloseMove: () => void
}

function ArtifactRow({
  artifact: a, topics, refreshingIds, renamingId, renameValue,
  movingId, onOpen, onDelete, onRefresh, onStartRename,
  onRenameChange, onRenameCommit, onRenameCancel, onToggleMove, onMove, onCloseMove,
}: ArtifactRowProps) {
  return (
    <li className="border border-app-border-2 rounded-md px-2.5 py-2 flex flex-col gap-1.5">
      {/* Top row: type badge + name (wraps freely) */}
      <div className="flex items-start gap-2">
        <TypeBadge type={a.type} />
        {renamingId === a.id ? (
          <input
            autoFocus
            value={renameValue}
            onChange={e => onRenameChange(e.target.value)}
            onBlur={() => onRenameCommit(a.id)}
            onKeyDown={e => {
              if (e.key === 'Enter') onRenameCommit(a.id)
              if (e.key === 'Escape') onRenameCancel()
            }}
            className="flex-1 bg-app-bg-card border border-app-border-3 rounded px-1 text-[12px] text-app-text-2 outline-none min-w-0"
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span
            className="text-[12px] font-medium text-app-text-2 cursor-text leading-snug"
            title={`${a.name} — click to rename`}
            onClick={() => onStartRename(a.id, a.name)}
          >
            {a.name}
          </span>
        )}
      </div>
      {/* Bottom row: timestamp + action icons */}
      <div className="flex items-center gap-0.5">
        <span className="text-[10px] text-app-text-7 flex-1">{relativeTime(a.updated_at)}</span>
        {getRefreshCommand(a) && (
          <button
            onClick={() => onRefresh(a.id)}
            disabled={refreshingIds.has(a.id)}
            title="Refresh artifact"
            className={`text-app-text-6 hover:text-app-text-3 flex-shrink-0 px-1 flex items-center disabled:opacity-50 ${refreshingIds.has(a.id) ? 'animate-spin' : ''}`}
          >↻</button>
        )}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => onToggleMove(a.id)}
            title="Move to topic"
            className="text-app-text-6 hover:text-app-text-3 px-1 flex items-center"
          >
            <FolderMoveIcon />
          </button>
          {movingId === a.id && (
            <MoveDropdown
              artifact={a}
              topics={topics}
              onMove={onMove}
              onClose={onCloseMove}
            />
          )}
        </div>
        <button
          onClick={() => onOpen(a)}
          title="Open artifact"
          className="text-app-text-6 hover:text-app-text-3 flex-shrink-0 px-1 flex items-center"
        >
          <EyeIcon />
        </button>
        <button
          onClick={() => onDelete(a.id)}
          title="Delete artifact"
          className="text-app-text-6 hover:text-red-500 flex-shrink-0 px-1 flex items-center"
        >
          <TrashIcon />
        </button>
      </div>
    </li>
  )
}

// ── Topic section ─────────────────────────────────────────────────────────────

interface TopicSectionProps {
  id: string | null   // null = root
  name: string        // '/' for root
  artifacts: Artifact[]
  topics: Topic[]
  collapsed: boolean
  renamingTopicId: string | null
  renameTopicValue: string
  refreshingIds: Set<string>
  renamingArtifactId: string | null
  renameArtifactValue: string
  movingArtifactId: string | null
  onToggleCollapse: (id: string) => void
  onStartRenameTopic: (id: string, name: string) => void
  onRenameTopicChange: (v: string) => void
  onRenameTopicCommit: (id: string) => void
  onRenameTopicCancel: () => void
  onDeleteTopic: (id: string) => void
  onOpen: (a: Artifact) => void
  onDeleteArtifact: (id: string) => void
  onRefreshArtifact: (id: string) => void
  onStartRenameArtifact: (id: string, name: string) => void
  onRenameArtifactChange: (v: string) => void
  onRenameArtifactCommit: (id: string) => void
  onRenameArtifactCancel: () => void
  onToggleMoveArtifact: (id: string) => void
  onMoveArtifact: (artifactId: string, topicId: string | null) => void
  onCloseMoveArtifact: () => void
}

function TopicSection({
  id, name, artifacts, topics, collapsed,
  renamingTopicId, renameTopicValue,
  refreshingIds, renamingArtifactId, renameArtifactValue, movingArtifactId,
  onToggleCollapse, onStartRenameTopic, onRenameTopicChange, onRenameTopicCommit,
  onRenameTopicCancel, onDeleteTopic, onOpen, onDeleteArtifact, onRefreshArtifact,
  onStartRenameArtifact, onRenameArtifactChange, onRenameArtifactCommit, onRenameArtifactCancel,
  onToggleMoveArtifact, onMoveArtifact, onCloseMoveArtifact,
}: TopicSectionProps) {
  const sectionId = id ?? 'root'
  const isRoot = id === null

  return (
    <div className="flex flex-col gap-1">
      {/* Section header */}
      <div className="flex items-center gap-1 group">
        <button
          onClick={() => onToggleCollapse(sectionId)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left py-0.5 text-app-text-6 hover:text-app-text-3"
        >
          <ChevronIcon open={!collapsed} />
          {(!isRoot && renamingTopicId === id) ? (
            <input
              autoFocus
              value={renameTopicValue}
              onChange={e => onRenameTopicChange(e.target.value)}
              onBlur={() => onRenameTopicCommit(id!)}
              onKeyDown={e => {
                if (e.key === 'Enter') onRenameTopicCommit(id!)
                if (e.key === 'Escape') onRenameTopicCancel()
              }}
              className="flex-1 bg-app-bg-card border border-app-border-3 rounded px-1 text-[11px] text-app-text-2 outline-none min-w-0"
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span
              className={`text-[11px] font-semibold tracking-wide truncate ${isRoot ? 'text-app-text-6' : 'text-app-text-5 cursor-text'}`}
              title={isRoot ? undefined : `${name} — click to rename`}
              onClick={isRoot ? undefined : (e) => { e.stopPropagation(); onStartRenameTopic(id!, name) }}
            >
              {isRoot ? '/' : name}
            </span>
          )}
          <span className="text-[10px] text-app-text-7 flex-shrink-0">({artifacts.length})</span>
        </button>
        {!isRoot && (
          <button
            onClick={() => onDeleteTopic(id!)}
            title="Delete topic (artifacts move to /)"
            className="opacity-0 group-hover:opacity-100 text-app-text-7 hover:text-red-500 px-1 flex items-center transition-opacity"
          >
            <TrashIcon />
          </button>
        )}
      </div>

      {/* Artifacts */}
      {!collapsed && (
        <ul className="flex flex-col gap-2 pl-3.5">
          {artifacts.length === 0 ? (
            <li className="text-[11px] text-app-text-7 italic py-1">
              {isRoot ? 'No artifacts yet — save a code block or ask the assistant to create one.' : 'Empty topic'}
            </li>
          ) : (
            artifacts.map(a => (
              <ArtifactRow
                key={a.id}
                artifact={a}
                topics={topics}
                refreshingIds={refreshingIds}
                renamingId={renamingArtifactId}
                renameValue={renameArtifactValue}
                movingId={movingArtifactId}
                onOpen={onOpen}
                onDelete={onDeleteArtifact}
                onRefresh={onRefreshArtifact}
                onStartRename={onStartRenameArtifact}
                onRenameChange={onRenameArtifactChange}
                onRenameCommit={onRenameArtifactCommit}
                onRenameCancel={onRenameArtifactCancel}
                onToggleMove={onToggleMoveArtifact}
                onMove={onMoveArtifact}
                onCloseMove={onCloseMoveArtifact}
              />
            ))
          )}
        </ul>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ArtifactPanel({ projectId, onOpen, refreshTick }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set())

  // Artifact rename state
  const [renamingArtifactId, setRenamingArtifactId] = useState<string | null>(null)
  const [renameArtifactValue, setRenameArtifactValue] = useState('')

  // Topic rename state
  const [renamingTopicId, setRenamingTopicId] = useState<string | null>(null)
  const [renameTopicValue, setRenameTopicValue] = useState('')

  // Move dropdown
  const [movingArtifactId, setMovingArtifactId] = useState<string | null>(null)

  // Collapsed sections (stored in localStorage)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(projectId))

  // New topic creation
  const [creatingTopic, setCreatingTopic] = useState(false)
  const [newTopicName, setNewTopicName] = useState('')

  // Load data
  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([listArtifacts(projectId), listTopics(projectId)])
      .then(([arts, tops]) => { setArtifacts(arts); setTopics(tops) })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [projectId, refreshTick])

  function toggleCollapse(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveCollapsed(projectId, next)
      return next
    })
  }

  // Artifact actions
  async function handleDeleteArtifact(id: string) {
    if (!window.confirm('Delete this artifact? This cannot be undone.')) return
    try {
      await deleteArtifact(id)
      setArtifacts(prev => prev.filter(a => a.id !== id))
    } catch (err) { console.error('[artifacts] delete failed:', err) }
  }

  async function handleRefreshArtifact(id: string) {
    setRefreshingIds(prev => new Set(prev).add(id))
    try {
      await refreshArtifact(id)
      const [arts, tops] = await Promise.all([listArtifacts(projectId), listTopics(projectId)])
      setArtifacts(arts); setTopics(tops)
    } catch (e) { console.error('Refresh failed', e) }
    finally { setRefreshingIds(prev => { const s = new Set(prev); s.delete(id); return s }) }
  }

  async function handleRenameArtifact(id: string) {
    const newName = renameArtifactValue.trim()
    setRenamingArtifactId(null)
    if (!newName || newName === artifacts.find(a => a.id === id)?.name) return
    try {
      await updateArtifact(id, { name: newName })
      setArtifacts(prev => prev.map(a => a.id === id ? { ...a, name: newName } : a))
    } catch (e) { console.error('Rename failed', e) }
  }

  async function handleMoveArtifact(artifactId: string, topicId: string | null) {
    try {
      await moveArtifactToTopic(artifactId, topicId)
      setArtifacts(prev => prev.map(a => a.id === artifactId ? { ...a, topic_id: topicId } : a))
    } catch (e) { console.error('Move failed', e) }
  }

  // Topic actions
  async function handleRenameTopic(id: string) {
    const newName = renameTopicValue.trim()
    setRenamingTopicId(null)
    if (!newName || newName === topics.find(t => t.id === id)?.name) return
    try {
      const updated = await updateTopic(id, newName)
      setTopics(prev => prev.map(t => t.id === id ? updated : t))
    } catch (e) { console.error('Topic rename failed', e) }
  }

  async function handleDeleteTopic(id: string) {
    if (!window.confirm('Delete this topic? All artifacts will move back to /.')) return
    try {
      await deleteTopic(id)
      setTopics(prev => prev.filter(t => t.id !== id))
      setArtifacts(prev => prev.map(a => a.topic_id === id ? { ...a, topic_id: null } : a))
    } catch (e) { console.error('Topic delete failed', e) }
  }

  async function handleCreateTopic() {
    const name = newTopicName.trim()
    setCreatingTopic(false)
    setNewTopicName('')
    if (!name) return
    try {
      const topic = await createTopic(projectId, name)
      setTopics(prev => [...prev, topic])
    } catch (e) { console.error('Create topic failed', e) }
  }

  // Group artifacts
  const rootArtifacts = artifacts.filter(a => a.topic_id === null)
  const artifactsByTopic = (topicId: string) => artifacts.filter(a => a.topic_id === topicId)

  // Determine if we have any topics at all
  const hasSections = topics.length > 0

  return (
    <div className="px-3 pb-3 flex flex-col gap-3">
      {loading ? (
        <p className="text-[11px] text-app-text-6">Loading…</p>
      ) : error ? (
        <p className="text-[11px] text-red-500">{error}</p>
      ) : !hasSections && artifacts.length === 0 ? (
        <p className="text-[11px] text-app-text-7 italic">
          No artifacts yet — save a code block or ask the assistant to create one.
        </p>
      ) : (
        <>
          {/* Root section — only show header when there are named topics */}
          {hasSections ? (
            <TopicSection
              id={null}
              name="/"
              artifacts={rootArtifacts}
              topics={topics}
              collapsed={collapsed.has('root')}
              renamingTopicId={renamingTopicId}
              renameTopicValue={renameTopicValue}
              refreshingIds={refreshingIds}
              renamingArtifactId={renamingArtifactId}
              renameArtifactValue={renameArtifactValue}
              movingArtifactId={movingArtifactId}
              onToggleCollapse={toggleCollapse}
              onStartRenameTopic={() => {}}
              onRenameTopicChange={setRenameTopicValue}
              onRenameTopicCommit={handleRenameTopic}
              onRenameTopicCancel={() => setRenamingTopicId(null)}
              onDeleteTopic={handleDeleteTopic}
              onOpen={onOpen}
              onDeleteArtifact={handleDeleteArtifact}
              onRefreshArtifact={handleRefreshArtifact}
              onStartRenameArtifact={(id, name) => { setRenamingArtifactId(id); setRenameArtifactValue(name) }}
              onRenameArtifactChange={setRenameArtifactValue}
              onRenameArtifactCommit={handleRenameArtifact}
              onRenameArtifactCancel={() => setRenamingArtifactId(null)}
              onToggleMoveArtifact={id => setMovingArtifactId(prev => prev === id ? null : id)}
              onMoveArtifact={handleMoveArtifact}
              onCloseMoveArtifact={() => setMovingArtifactId(null)}
            />
          ) : (
            // No topics: render flat list without any section header
            <ul className="flex flex-col gap-2">
              {artifacts.map(a => (
                <ArtifactRow
                  key={a.id}
                  artifact={a}
                  topics={topics}
                  refreshingIds={refreshingIds}
                  renamingId={renamingArtifactId}
                  renameValue={renameArtifactValue}
                  movingId={movingArtifactId}
                  onOpen={onOpen}
                  onDelete={handleDeleteArtifact}
                  onRefresh={handleRefreshArtifact}
                  onStartRename={(id, name) => { setRenamingArtifactId(id); setRenameArtifactValue(name) }}
                  onRenameChange={setRenameArtifactValue}
                  onRenameCommit={handleRenameArtifact}
                  onRenameCancel={() => setRenamingArtifactId(null)}
                  onToggleMove={id => setMovingArtifactId(prev => prev === id ? null : id)}
                  onMove={handleMoveArtifact}
                  onCloseMove={() => setMovingArtifactId(null)}
                />
              ))}
            </ul>
          )}

          {/* Named topic sections */}
          {topics.map(topic => (
            <TopicSection
              key={topic.id}
              id={topic.id}
              name={topic.name}
              artifacts={artifactsByTopic(topic.id)}
              topics={topics}
              collapsed={collapsed.has(topic.id)}
              renamingTopicId={renamingTopicId}
              renameTopicValue={renameTopicValue}
              refreshingIds={refreshingIds}
              renamingArtifactId={renamingArtifactId}
              renameArtifactValue={renameArtifactValue}
              movingArtifactId={movingArtifactId}
              onToggleCollapse={toggleCollapse}
              onStartRenameTopic={(id, name) => { setRenamingTopicId(id); setRenameTopicValue(name) }}
              onRenameTopicChange={setRenameTopicValue}
              onRenameTopicCommit={handleRenameTopic}
              onRenameTopicCancel={() => setRenamingTopicId(null)}
              onDeleteTopic={handleDeleteTopic}
              onOpen={onOpen}
              onDeleteArtifact={handleDeleteArtifact}
              onRefreshArtifact={handleRefreshArtifact}
              onStartRenameArtifact={(id, name) => { setRenamingArtifactId(id); setRenameArtifactValue(name) }}
              onRenameArtifactChange={setRenameArtifactValue}
              onRenameArtifactCommit={handleRenameArtifact}
              onRenameArtifactCancel={() => setRenamingArtifactId(null)}
              onToggleMoveArtifact={id => setMovingArtifactId(prev => prev === id ? null : id)}
              onMoveArtifact={handleMoveArtifact}
              onCloseMoveArtifact={() => setMovingArtifactId(null)}
            />
          ))}
        </>
      )}

      {/* New topic controls */}
      <div className="mt-1">
        {creatingTopic ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={newTopicName}
              onChange={e => setNewTopicName(e.target.value)}
              onBlur={handleCreateTopic}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleCreateTopic()
                if (e.key === 'Escape') { setCreatingTopic(false); setNewTopicName('') }
              }}
              placeholder="Topic name…"
              className="flex-1 bg-app-bg-card border border-app-border-3 rounded px-2 py-1 text-[12px] text-app-text-2 outline-none"
            />
          </div>
        ) : (
          <button
            onClick={() => setCreatingTopic(true)}
            className="text-[11px] text-app-text-7 hover:text-app-text-4 flex items-center gap-1"
          >
            <span>+</span> New topic
          </button>
        )}
      </div>
    </div>
  )
}
