import { useState, useEffect } from 'react'
import {
  listProjects, createProject, deleteProject,
  listSessions, createSession, deleteSession, renameSession,
  subscribeToAppEvents,
  type Project, type Session,
} from './lib/api'
import { SessionSidebar } from './components/SessionSidebar'
import { ChatWindow } from './components/ChatWindow'

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    return subscribeToAppEvents({
      onReload: () => {
        setRestarting(true)
        setTimeout(() => window.location.reload(), 1500)
      },
    })
  }, [])

  // Load projects on mount
  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(console.error)
  }, [])

  // Load sessions whenever the active project changes
  useEffect(() => {
    setLoading(true)
    setActiveSessionId(null)
    listSessions(activeProjectId)
      .then((data) => {
        setSessions(data)
        if (data.length > 0) setActiveSessionId(data[0].id)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [activeProjectId])

  async function handleSelectProject(id: string | null) {
    setActiveProjectId(id)
  }

  async function handleCreateProject(name: string, path: string) {
    const project = await createProject(name, path)
    setProjects((prev) => [...prev, project])
    setActiveProjectId(project.id)
  }

  async function handleDeleteProject(id: string) {
    await deleteProject(id)
    setProjects((prev) => prev.filter((p) => p.id !== id))
    if (activeProjectId === id) setActiveProjectId(null)
  }

  async function handleNewSession() {
    try {
      const session = await createSession(activeProjectId)
      setSessions((prev) => [session, ...prev])
      setActiveSessionId(session.id)
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }

  function handleTitleUpdate(sessionId: string, title: string) {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title } : s))
    )
  }

  async function handleDeleteSession(sessionId: string) {
    try {
      await deleteSession(sessionId)
      setSessions((prev) => {
        const remaining = prev.filter((s) => s.id !== sessionId)
        if (activeSessionId === sessionId) {
          setActiveSessionId(remaining.length > 0 ? remaining[0].id : null)
        }
        return remaining
      })
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }

  async function handleDeleteAllSessions() {
    const ids = sessions.map((s) => s.id)
    await Promise.allSettled(ids.map(deleteSession))
    setSessions([])
    setActiveSessionId(null)
  }

  function handleSessionActivity(sessionId: string) {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === sessionId)
      if (idx <= 0) return prev
      const updated = [...prev]
      const [moved] = updated.splice(idx, 1)
      return [moved, ...updated]
    })
  }

  async function handleRenameSession(sessionId: string, title: string) {
    const updated = await renameSession(sessionId, title)
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)))
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.metaKey && !e.ctrlKey) return
      if (e.key === 'n') {
        e.preventDefault()
        handleNewSession()
      } else if (e.key === '[') {
        e.preventDefault()
        setSessions((prev) => {
          const idx = prev.findIndex((s) => s.id === activeSessionId)
          const next = prev[idx + 1]
          if (next) setActiveSessionId(next.id)
          return prev
        })
      } else if (e.key === ']') {
        e.preventDefault()
        setSessions((prev) => {
          const idx = prev.findIndex((s) => s.id === activeSessionId)
          const next = prev[idx - 1]
          if (next) setActiveSessionId(next.id)
          return prev
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, sessions])

  return (
    <div className="app">
      {restarting && (
        <div className="restart-overlay">
          <p>Restarting…</p>
        </div>
      )}
      <SessionSidebar
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
        onCreateProject={handleCreateProject}
        onDeleteProject={handleDeleteProject}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onDeleteAllSessions={handleDeleteAllSessions}
        onRenameSession={handleRenameSession}
        loading={loading}
      />
      <main className="app__main">
        {activeSessionId ? (
          <ChatWindow
            key={activeSessionId}
            sessionId={activeSessionId}
            onTitle={(title) => handleTitleUpdate(activeSessionId, title)}
            onActivity={() => handleSessionActivity(activeSessionId)}
          />
        ) : (
          <div className="app__empty">
            <p>{activeProjectId ? 'No sessions in this project yet.' : 'Select a project or create a new chat.'}</p>
            <button className="app__empty-btn" onClick={handleNewSession}>
              New Chat
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
