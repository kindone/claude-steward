import { useState, useRef, useEffect, useCallback } from 'react'
import type { Session, Project } from '../lib/api'
import { ProjectPicker } from './ProjectPicker'
import { FileTree } from './FileTree'
import { TerminalPanel } from './TerminalPanel'

type Props = {
  projects: Project[]
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
  onCreateProject: (name: string, path: string) => Promise<void>
  onDeleteProject: (id: string) => void
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
}

export function SessionSidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
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
}: Props) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<'sessions' | 'files' | 'terminal'>(() => {
    try { return (localStorage.getItem('steward:sidebarTab') as 'sessions' | 'files' | 'terminal') ?? 'sessions' }
    catch { return 'sessions' }
  })

  const switchTab = useCallback((tab: 'sessions' | 'files' | 'terminal') => {
    setActiveTab(tab)
    try { localStorage.setItem('steward:sidebarTab', tab) } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (editingId) editInputRef.current?.select()
  }, [editingId])

  function startEditing(e: React.MouseEvent, session: Session) {
    e.stopPropagation()
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
    setPendingDeleteId(null)
    onSelectSession(id)
  }

  function handleDeleteClick(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    setPendingDeleteId(pendingDeleteId === id ? null : id)
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
          protectedPath={protectedProjectPath}
        />
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[#1f1f1f] flex-shrink-0">
        {(['sessions', 'files', 'terminal'] as const).map((tab) => (
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
                Sessions
                {sessions.length > 0 && (
                  <span className="bg-[#2a2a2a] text-[#666] text-[10px] font-semibold px-1.5 py-px rounded-full">
                    {sessions.length}
                  </span>
                )}
              </span>
            ) : tab === 'terminal' ? 'Term' : 'Files'}
          </button>
        ))}
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
                    <span
                      className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap select-none"
                      onDoubleClick={(e) => startEditing(e, s)}
                      title="Double-click to rename"
                    >
                      {s.title}
                    </span>
                    <button
                      className="flex-shrink-0 bg-transparent border-none cursor-pointer text-[15px] leading-none px-1 py-0.5 rounded transition-colors
                        text-transparent group-hover:text-[#444] [@media(hover:none)]:text-[#444]
                        hover:!text-red-500 hover:bg-red-500/10"
                      onClick={(e) => handleDeleteClick(e, s.id)}
                      title="Delete session"
                    >
                      ×
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

      {/* Files tab */}
      {activeTab === 'files' && (
        activeProjectId
          ? <FileTree projectId={activeProjectId} alwaysExpanded />
          : <p className="px-3 py-4 text-[12px] text-[#444] italic">No project selected</p>
      )}

      {/* Terminal tab — always mounted once first shown so xterm.js instance survives tab switches */}
      <div className={`flex-1 min-h-0 flex flex-col ${activeTab === 'terminal' ? '' : 'hidden'}`}>
        {activeProjectId
          ? <TerminalPanel projectId={activeProjectId} />
          : <p className="px-3 py-4 text-[12px] text-[#444] italic">No project selected</p>
        }
      </div>

      {/* Sign out — desktop only (mobile has it in the header bar) */}
      {onLogout && (
        <div className="hidden md:block border-t border-[#1f1f1f] p-2">
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-2 px-2 py-2 rounded text-xs text-[#555] hover:text-[#aaa] hover:bg-[#1a1a1a] transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
            </svg>
            Sign out
          </button>
        </div>
      )}
    </aside>
  )
}
