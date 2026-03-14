import { useState } from 'react'
import type { Session, Project } from '../lib/api'
import { ProjectPicker } from './ProjectPicker'
import { FileTree } from './FileTree'

type Props = {
  projects: Project[]
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
  onCreateProject: (name: string, path: string) => Promise<void>
  onDeleteProject: (id: string) => void
  sessions: Session[]
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onDeleteSession: (id: string) => void
  onDeleteAllSessions: () => void
  loading: boolean
}

export function SessionSidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onDeleteAllSessions,
  loading,
}: Props) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

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
    <aside className="sidebar">
      {/* Project switcher */}
      <div className="sidebar__project-bar">
        <ProjectPicker
          projects={projects}
          activeProjectId={activeProjectId}
          onSelect={onSelectProject}
          onCreate={onCreateProject}
          onDelete={onDeleteProject}
        />
      </div>

      {/* Sessions */}
      <div className="sidebar__section-header">
        <span className="sidebar__section-label">
          Sessions
          {sessions.length > 0 && (
            <span className="sidebar__count">{sessions.length}</span>
          )}
        </span>
        <div className="sidebar__header-actions">
          {sessions.length > 1 && (
            <button
              className="sidebar__clear-btn"
              onClick={handleClearAll}
              title="Delete all sessions"
            >
              Clear all
            </button>
          )}
          <button className="sidebar__new-btn" onClick={onNewSession} title="New Chat">+</button>
        </div>
      </div>
      <ul className="sidebar__list">
        {sessions.map((s) => (
          <li
            key={s.id}
            className={`sidebar__item${s.id === activeSessionId ? ' sidebar__item--active' : ''}${pendingDeleteId === s.id ? ' sidebar__item--confirming' : ''}`}
            onClick={() => handleSessionClick(s.id)}
          >
            {pendingDeleteId === s.id ? (
              <span className="sidebar__confirm">
                <span className="sidebar__confirm-label">Delete?</span>
                <button className="sidebar__confirm-yes" onClick={(e) => handleConfirmDelete(e, s.id)}>Yes</button>
                <button className="sidebar__confirm-no" onClick={handleCancelDelete}>No</button>
              </span>
            ) : (
              <>
                <span className="sidebar__item-title">{s.title}</span>
                <button
                  className="sidebar__delete-btn"
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
          <li className="sidebar__empty-hint">No sessions yet</li>
        )}
      </ul>
      {loading && <p className="sidebar__loading">Loading…</p>}

      {/* File tree (only when a project is active) */}
      {activeProjectId && <FileTree projectId={activeProjectId} />}
    </aside>
  )
}
