import type { Session } from '../lib/api'

type Props = {
  sessions: Session[]
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onDeleteSession: (id: string) => void
  loading: boolean
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  loading,
}: Props) {
  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (window.confirm('Delete this session and all its messages?')) {
      onDeleteSession(id)
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <span className="sidebar__title">Claude Steward</span>
        <button className="sidebar__new-btn" onClick={onNewSession} title="New Chat">
          +
        </button>
      </div>
      <ul className="sidebar__list">
        {sessions.map((s) => (
          <li
            key={s.id}
            className={`sidebar__item${s.id === activeSessionId ? ' sidebar__item--active' : ''}`}
            onClick={() => onSelectSession(s.id)}
          >
            <span className="sidebar__item-title">{s.title}</span>
            <button
              className="sidebar__delete-btn"
              onClick={(e) => handleDelete(e, s.id)}
              title="Delete session"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {loading && <p className="sidebar__loading">Loading…</p>}
    </aside>
  )
}
