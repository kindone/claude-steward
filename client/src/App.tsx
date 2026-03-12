import { useState, useEffect } from 'react'
import { listSessions, createSession, deleteSession, subscribeToAppEvents, type Session } from './lib/api'
import { SessionSidebar } from './components/SessionSidebar'
import { ChatWindow } from './components/ChatWindow'

export default function App() {
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

  useEffect(() => {
    listSessions()
      .then((data) => {
        setSessions(data)
        if (data.length > 0) setActiveSessionId(data[0].id)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function handleNewSession() {
    try {
      const session = await createSession()
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

  return (
    <div className="app">
      {restarting && (
        <div className="restart-overlay">
          <p>Restarting…</p>
        </div>
      )}
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        loading={loading}
      />
      <main className="app__main">
        {activeSessionId ? (
          <ChatWindow
            key={activeSessionId}
            sessionId={activeSessionId}
            onTitle={(title) => handleTitleUpdate(activeSessionId, title)}
          />
        ) : (
          <div className="app__empty">
            <p>Create a new chat to get started.</p>
            <button className="app__empty-btn" onClick={handleNewSession}>
              New Chat
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
