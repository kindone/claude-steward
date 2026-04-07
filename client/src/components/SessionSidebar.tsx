import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Session, Project, Artifact } from '../lib/api'
import { ProjectPicker } from './ProjectPicker'
import { FileTree } from './FileTree'
import { TerminalPanel } from './TerminalPanel'
import { AppsPanel } from './AppsPanel'
import { ArtifactPanel } from './ArtifactPanel'
import { usePushNotifications } from '../hooks/usePushNotifications'
import type { ConnState } from '../hooks/useAppConnection'

type Props = {
  projects: Project[]
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
  onCreateProject: (name: string, path: string) => Promise<void>
  onDeleteProject: (id: string) => void
  onUpdateProjectSystemPrompt?: (projectId: string, systemPrompt: string | null) => Promise<void>
  protectedProjectPath?: string | null
  sessions: Session[]
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onDeleteSession: (id: string) => void
  onDeleteAllSessions: () => void
  onRenameSession: (id: string, title: string) => Promise<void>
  loading: boolean
  onClose?: () => void
  onLogout?: () => void
  connState?: ConnState
  lastSeenAt?: number | null
  onOpenApp?: (url: string, name: string) => void
  onOpenArtifact: (artifact: Artifact) => void
  artifactRefreshTick?: number
}

export function SessionSidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onUpdateProjectSystemPrompt,
  protectedProjectPath,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onDeleteAllSessions,
  onRenameSession,
  loading,
  onClose,
  onLogout,
  connState,
  lastSeenAt,
  onOpenApp,
  onOpenArtifact,
  artifactRefreshTick,
}: Props) {
  const { state: pushState, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePushNotifications()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [activeTab, setActiveTab] = useState<'sessions' | 'files' | 'terminal' | 'apps' | 'artifacts'>(() => {
    try { return (localStorage.getItem('steward:sidebarTab') as 'sessions' | 'files' | 'terminal' | 'apps' | 'artifacts') ?? 'sessions' }
    catch { return 'sessions' }
  })

  const switchTab = useCallback((tab: 'sessions' | 'files' | 'terminal' | 'apps' | 'artifacts') => {
    setActiveTab(tab)
    try { localStorage.setItem('steward:sidebarTab', tab) } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (editingId) editInputRef.current?.select()
  }, [editingId])

  function closeMenu() {
    setOpenMenuId(null)
    setMenuPos(null)
  }

  function handleMenuOpen(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (openMenuId === id) { closeMenu(); return }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenuPos({ x: rect.right, y: rect.bottom })
    setOpenMenuId(id)
  }

  function startEditing(session: Session) {
    closeMenu()
    setPendingDeleteId(null)
    setEditingId(session.id)
    setEditValue(session.title)
  }

  async function commitRename() {
    if (!editingId) return
    const trimmed = editValue.trim()
    if (trimmed) await onRenameSession(editingId, trimmed)
    setEditingId(null)
  }

  function cancelRename() {
    setEditingId(null)
  }

  function handleSessionClick(id: string) {
    closeMenu()
    setPendingDeleteId(null)
    onSelectSession(id)
  }

  function handleDeleteFromMenu(id: string) {
    closeMenu()
    setPendingDeleteId(id)
  }

  function handleConfirmDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    setPendingDeleteId(null)
    onDeleteSession(id)
  }

  function handleCancelDelete(e: React.MouseEvent) {
    e.stopPropagation()
    setPendingDeleteId(null)
  }

  function handleClearAll(e: React.MouseEvent) {
    e.stopPropagation()
    if (sessions.length === 0) return
    if (window.confirm(`Delete all ${sessions.length} session${sessions.length === 1 ? '' : 's'} and their messages?`)) {
      onDeleteAllSessions()
    }
  }

  return (
    <aside className="h-dvh w-64 flex flex-col bg-[#111] border-r border-[#1f1f1f] overflow-hidden">
      {/* Mobile close button */}
      <div className="flex items-center justify-end px-2 pt-2 md:hidden">
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center text-[#555] hover:text-[#aaa] text-xl rounded"
          aria-label="Close sidebar"
        >
          ✕
        </button>
      </div>

      {/* Project switcher */}
      <div className="border-b border-[#1f1f1f] relative">
        <ProjectPicker
          projects={projects}
          activeProjectId={activeProjectId}
          onSelect={onSelectProject}
          onCreate={onCreateProject}
          onDelete={onDeleteProject}
          onUpdateSystemPrompt={onUpdateProjectSystemPrompt}
          protectedPath={protectedProjectPath}
        />
      </div>

      {/* Tab bar */}
      <div className="flex items-stretch border-b border-[#1f1f1f] flex-shrink-0">
        {(['sessions', 'files', 'apps', 'artifacts', 'terminal'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => switchTab(tab)}
            className={`flex-1 py-2 text-[10px] font-semibold tracking-widest uppercase transition-colors border-b-2
              ${activeTab === tab
                ? 'text-[#e8e8e8] border-blue-500'
                : 'text-[#555] border-transparent hover:text-[#888]'}`}
          >
            {tab === 'sessions' ? (
              <span className="flex items-center justify-center gap-1">
                Chats
                {sessions.length > 0 && (
                  <span className="bg-[#2a2a2a] text-[#666] text-[10px] font-semibold px-1.5 py-px rounded-full">
                    {sessions.length}
                  </span>
                )}
              </span>
            ) : tab === 'terminal' ? 'Term' : tab === 'apps' ? 'Apps' : tab === 'artifacts' ? 'Art' : 'Files'}
          </button>
        ))}
        {/* Push notification bell — tab bar keeps it always visible on all screen sizes */}
        {pushState !== 'unsupported' && (
          <button
            onClick={() => {
              if (pushState === 'granted') pushUnsubscribe()
              else if (pushState === 'default') pushSubscribe()
            }}
            disabled={pushState === 'loading' || pushState === 'denied'}
            title={
              pushState === 'granted' ? 'Notifications on — click to disable'
                : pushState === 'denied' ? 'Notifications blocked in browser settings'
                : pushState === 'loading' ? 'Loading…'
                : 'Enable push notifications'
            }
            className={`px-3 border-b-2 border-transparent text-base leading-none transition-colors
              ${pushState === 'granted' ? 'text-blue-400 hover:text-blue-300'
                : pushState === 'denied' ? 'text-[#333] cursor-not-allowed'
                : 'text-[#555] hover:text-[#888]'}`}
          >
            {pushState === 'granted' ? '🔔' : '🔕'}
          </button>
        )}
      </div>

      {/* Sessions tab */}
      {activeTab === 'sessions' && (
        <>
          <div className="flex items-center justify-end px-3 pt-2 pb-1 flex-shrink-0">
            <div className="flex items-center gap-1">
              {sessions.length > 1 && (
                <button
                  className="bg-transparent border-none text-[#444] text-[11px] cursor-pointer px-1.5 py-0.5 rounded hover:text-red-500 hover:bg-red-500/[0.08] transition-colors"
                  onClick={handleClearAll}
                  title="Delete all sessions"
                >
                  Clear all
                </button>
              )}
              <button
                className="bg-[#1e3a5f] hover:bg-blue-600 text-white border-none w-8 h-8 rounded-md cursor-pointer text-lg leading-none flex items-center justify-center transition-colors"
                onClick={onNewSession}
                title="New Chat"
              >
                +
              </button>
            </div>
          </div>

          <ul className="list-none flex-1 overflow-y-auto px-2 py-1 flex flex-col gap-0.5">
            {sessions.map((s) => (
              <li
                key={s.id}
                className={`group flex items-center gap-1 px-2.5 py-2 rounded-md cursor-pointer text-sm border transition-colors
                  ${s.id === activeSessionId
                    ? 'bg-[#1e3a5f] text-[#e8e8e8] border-transparent'
                    : 'text-[#bbb] border-transparent hover:bg-[#1a1a1a] hover:text-[#e8e8e8]'}
                  ${pendingDeleteId === s.id ? '!bg-red-500/[0.08] !border-red-500/20' : ''}`}
                onClick={() => handleSessionClick(s.id)}
              >
                {editingId === s.id ? (
                  <input
                    ref={editInputRef}
                    className="flex-1 bg-[#0d0d0d] border border-blue-600 rounded text-[#e8e8e8] text-[13px] px-1.5 py-0.5 outline-none min-w-0"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                      if (e.key === 'Escape') cancelRename()
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : pendingDeleteId === s.id ? (
                  <span className="flex items-center gap-1.5 w-full">
                    <span className="flex-1 text-[12px] text-red-300">Delete?</span>
                    <button
                      className="bg-transparent border border-red-500/50 rounded text-red-500 text-[11px] px-2 py-1 cursor-pointer flex-shrink-0 hover:bg-red-500/15 min-h-[32px]"
                      onClick={(e) => handleConfirmDelete(e, s.id)}
                    >
                      Yes
                    </button>
                    <button
                      className="bg-transparent border border-[#333] rounded text-[#666] text-[11px] px-2 py-1 cursor-pointer flex-shrink-0 hover:text-[#aaa] hover:border-[#555] min-h-[32px]"
                      onClick={handleCancelDelete}
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <>
                    <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap select-none">
                      {s.title}
                    </span>
                    {/* 3-dot menu button — always visible on touch, visible on hover on pointer devices */}
                    <button
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-colors
                        text-transparent group-hover:text-[#555] [@media(hover:none)]:text-[#555]
                        hover:!text-[#aaa] hover:!bg-[#2a2a2a]"
                      onClick={(e) => handleMenuOpen(e, s.id)}
                      title="Session options"
                      aria-label="Session options"
                    >
                      <svg width="14" height="4" viewBox="0 0 14 4" fill="currentColor">
                        <circle cx="2" cy="2" r="1.5"/>
                        <circle cx="7" cy="2" r="1.5"/>
                        <circle cx="12" cy="2" r="1.5"/>
                      </svg>
                    </button>
                  </>
                )}
              </li>
            ))}
            {!loading && sessions.length === 0 && (
              <li className="px-2.5 py-2 text-[12px] text-[#444] italic">No sessions yet</li>
            )}
          </ul>

          {loading && <p className="px-3 py-3 text-[12px] text-[#555] text-center">Loading…</p>}
        </>
      )}

      {/* Apps tab */}
      {activeTab === 'apps' && (() => {
        const project = projects.find((p) => p.id === activeProjectId)
        return project
          ? <AppsPanel projectId={project.id} projectPath={project.path} onOpenApp={onOpenApp} />
          : <p className="px-3 py-4 text-[12px] text-[#444] italic">No project selected</p>
      })()}

      {/* Files tab */}
      {activeTab === 'files' && (
        activeProjectId
          ? <FileTree projectId={activeProjectId} alwaysExpanded />
          : <p className="px-3 py-4 text-[12px] text-[#444] italic">No project selected</p>
      )}

      {/* Artifacts tab */}
      {activeTab === 'artifacts' && activeProjectId && (
        <ArtifactPanel
          projectId={activeProjectId}
          onOpen={onOpenArtifact}
          refreshTick={artifactRefreshTick}
        />
      )}
      {activeTab === 'artifacts' && !activeProjectId && (
        <p className="px-3 py-4 text-[12px] text-[#444] italic">No project selected</p>
      )}

      {/* Terminal tab — always mounted once first shown so xterm.js instance survives tab switches */}
      <div className={`flex-1 min-h-0 flex flex-col ${activeTab === 'terminal' ? '' : 'hidden'}`}>
        {activeProjectId
          ? <TerminalPanel projectId={activeProjectId} />
          : <p className="px-3 py-4 text-[12px] text-[#444] italic">No project selected</p>
        }
      </div>

      {/* Desktop footer: connection status + sign out */}
      <div className="hidden md:flex items-center border-t border-[#1f1f1f] p-2 gap-1">
        {connState && (
          <span
            className="flex items-center gap-1.5 px-2 py-2 text-xs text-[#444] cursor-default select-none flex-1 min-w-0"
            title={`${connState === 'connected' ? 'Connected' : connState === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'} · last activity: ${lastSeenAt == null ? 'never' : (() => { const s = Math.floor((Date.now() - lastSeenAt) / 1000); return s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago` })()}`}
          >
            <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${connState === 'connected' ? 'bg-green-500' : connState === 'reconnecting' ? 'bg-amber-400 animate-pulse' : 'bg-[#444]'}`} />
            <span className="truncate">{connState === 'connected' ? 'Connected' : connState === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span>
          </span>
        )}
        {onLogout && (
          <button
            onClick={onLogout}
            className="flex items-center justify-center w-8 h-8 rounded text-[#555] hover:text-[#aaa] hover:bg-[#1a1a1a] transition-colors flex-shrink-0"
            title="Sign out"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
            </svg>
          </button>
        )}
      </div>

      {/* 3-dot dropdown — portalled to document.body to escape the sidebar's transform stacking context */}
      {openMenuId && menuPos && (() => {
        const session = sessions.find((s) => s.id === openMenuId)
        if (!session) return null
        return createPortal(
          <>
            {/* Backdrop to close menu */}
            <div className="fixed inset-0 z-[9990]" onClick={closeMenu} />
            {/* Menu */}
            <div
              className="fixed z-[9991] bg-[#1c1c1c] border border-[#2e2e2e] rounded-lg shadow-2xl py-1 min-w-[140px] overflow-hidden"
              style={{ right: window.innerWidth - menuPos.x, top: menuPos.y + 4 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="w-full text-left px-3 py-2 text-[13px] text-[#ccc] hover:bg-[#2a2a2a] hover:text-[#e8e8e8] transition-colors flex items-center gap-2.5"
                onClick={() => startEditing(session)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Rename
              </button>
              <div className="h-px bg-[#2e2e2e] mx-2 my-1" />
              <button
                className="w-full text-left px-3 py-2 text-[13px] text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors flex items-center gap-2.5"
                onClick={() => handleDeleteFromMenu(session.id)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
                Delete
              </button>
            </div>
          </>,
          document.body
        )
      })()}
    </aside>
  )
}
