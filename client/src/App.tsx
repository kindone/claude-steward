import { useState, useEffect, useRef, useCallback, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import {
  listProjects, createProject, deleteProject, fetchMeta, updatePermissionMode, updateProject,
  listSessions, createSession, deleteSession, renameSession,
  getAuthStatus, logout,
  getArtifactContent, putArtifactContent,
  type Project, type Session, type Artifact,
} from './lib/api'
import { SessionSidebar } from './components/SessionSidebar'
import { ChatWindow } from './components/ChatWindow'
import { AppViewPanel } from './components/AppViewPanel'
import AuthPage from './components/AuthPage'
import { ErrorConsole } from './components/ErrorConsole'
import { useAppConnection, type ConnState } from './hooks/useAppConnection'
import { ArtifactFloat, type OpenArtifact } from './components/ArtifactFloat'

type AuthState = 'loading' | 'unauthenticated' | 'authenticated'

function formatLastSeen(ts: number | null): string {
  if (ts === null) return 'never'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function ConnectionDot({ state, lastSeenAt }: { state: ConnState; lastSeenAt: number | null }) {
  const dot =
    state === 'connected'    ? 'bg-green-500' :
    state === 'reconnecting' ? 'bg-amber-400 animate-pulse' :
                               'bg-[#444]'
  const label =
    state === 'connected'    ? 'Connected' :
    state === 'reconnecting' ? 'Reconnecting…' :
                               'Connecting…'
  return (
    <span
      className="flex items-center gap-1.5 px-1 cursor-default select-none"
      title={`${label} · last activity: ${formatLastSeen(lastSeenAt)}`}
    >
      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
    </span>
  )
}

const LAST_STATE_KEY = 'steward:lastState'

function readLastState(): { projectId: string | null; sessionId: string | null } {
  try {
    const raw = localStorage.getItem(LAST_STATE_KEY)
    return raw ? JSON.parse(raw) : { projectId: null, sessionId: null }
  } catch {
    return { projectId: null, sessionId: null }
  }
}

function saveLastState(projectId: string | null, sessionId: string | null): void {
  try {
    localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ projectId, sessionId }))
  } catch { /* quota exceeded or private mode — ignore */ }
}

// ── Error Boundary ────────────────────────────────────────────────────────────

type EBProps = { children: ReactNode; onError: (msg: string, stack?: string) => void }
type EBState = { crashed: boolean }

class ErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { crashed: false }
  componentDidCatch(error: Error, info: ErrorInfo) {
    const stack = [error.stack, info.componentStack].filter(Boolean).join('\n\n--- Component stack ---\n')
    this.props.onError(`React render error: ${error.message}`, stack || undefined)
  }
  static getDerivedStateFromError() { return { crashed: false } }
  render() { return this.props.children }
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [hasCredentials, setHasCredentials] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  // Ref so the SW message handler always sees the latest sessions without re-registering
  const sessionsRef = useRef<Session[]>([])
  // Read ?session= and ?project= URL params once on mount (set by push notification tap via
  // openWindow). Stored in refs so they survive multiple effect re-runs: the project load
  // triggers a second sessions-effect run that would otherwise overwrite the correct selection.
  const pendingSessionIdRef = useRef<string | null>(
    new URLSearchParams(window.location.search).get('session')
  )
  // ?project= lets us select the right project immediately instead of falling back to localStorage
  const pendingProjectIdRef = useRef<string | null>(
    new URLSearchParams(window.location.search).get('project')
  )
  const [appRoot, setAppRoot] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [restarting, setRestarting] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [clientErrors, setClientErrors] = useState<import('./components/ErrorConsole').ErrorEntry[]>([])
  const [appPanel, setAppPanel] = useState<{ url: string; name: string } | null>(null)
  const [appPanelPreset, setAppPanelPreset] = useState<'half' | 'wide'>('half')
  // Incremented whenever the MCP server notifies us that schedules changed,
  // so ChatWindow/SchedulePanel can re-fetch without polling.
  const [schedulesTick, setSchedulesTick] = useState(0)
  // Incremented whenever the server notifies us that an artifact was updated,
  // so ArtifactPanel can re-fetch without polling.
  const [artifactRefreshTick, setArtifactRefreshTick] = useState(0)

  // ── Artifact float panel ──────────────────────────────────────────────────────
  const [openArtifacts, setOpenArtifacts] = useState<OpenArtifact[]>([])
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  // Ref so SSE handler always sees the latest openArtifacts without re-registering
  const openArtifactsRef = useRef<OpenArtifact[]>([])
  useEffect(() => { openArtifactsRef.current = openArtifacts }, [openArtifacts])

  // Capture unhandled JS errors and promise rejections for visibility
  const pushError = useCallback((message: string, stack?: string) => {
    setClientErrors((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, timestamp: Date.now(), message, stack },
    ])
  }, [])

  useEffect(() => {
    const onError = (e: ErrorEvent) => pushError(e.message ?? 'Unknown error', e.error?.stack)
    const onUnhandled = (e: PromiseRejectionEvent) => {
      const reason = e.reason
      // Browsers (especially Safari) fire extra unhandledrejection events from
      // internal stream machinery when a fetch body is aborted. These are benign
      // and already handled by our isAbortError guards — suppress them here.
      if (reason instanceof Error) {
        if (reason.name === 'AbortError' || reason.message?.includes('BodyStreamBuffer was aborted')) return
      }
      const msg = String(reason?.message ?? reason ?? 'Unhandled rejection')
      pushError(msg, reason?.stack)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandled)
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onUnhandled) }
  }, [pushError])

  // Keep sessionsRef in sync so the SW message handler always has the latest list
  useEffect(() => { sessionsRef.current = sessions }, [sessions])

  // Clear ?session= / ?project= URL params immediately so they don't persist in browser history
  useEffect(() => {
    if (pendingSessionIdRef.current || pendingProjectIdRef.current) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // Register service worker on mount so it's always available for push notifications,
  // regardless of whether a session/ChatWindow is open.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  // Push notification navigation — handles two scenarios:
  //
  // 1. App backgrounded (iOS): SSE dies, notificationclick doesn't fire.
  //    Server stores last push target in memory. On visibilitychange,
  //    page polls GET /api/push/last-target and navigates.
  //
  // 2. App in foreground: SSE is alive so the server broadcasts a
  //    'pushTarget' event. Page navigates immediately without polling.
  const navigateToPushTarget = useCallback((sessionId: string, projectId: string | null) => {
    if (sessionsRef.current.some((s) => s.id === sessionId)) {
      setActiveSessionId(sessionId)
    } else if (projectId) {
      pendingSessionIdRef.current = sessionId
      setActiveProjectId(projectId)
    } else {
      window.location.href = `/?session=${sessionId}`
    }
  }, [])

  // Foreground: SSE pushTarget event — don't auto-navigate (that would switch
  // sessions without user intent). Instead, show a dismissible in-app toast that
  // the user can tap to switch. iOS doesn't fire notificationclick so this is the
  // only way to offer navigation when the app is already visible.
  const [pushToast, setPushToast] = useState<{ sessionId: string; projectId: string | null; title: string; body?: string } | null>(null)
  const pushToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handlePushTarget = useCallback((target: { sessionId: string; projectId: string | null; title?: string; body?: string }) => {
    setPushToast({ sessionId: target.sessionId, projectId: target.projectId, title: target.title ?? 'New message', body: target.body })
    // Auto-dismiss after 8 seconds
    if (pushToastTimerRef.current) clearTimeout(pushToastTimerRef.current)
    pushToastTimerRef.current = setTimeout(() => setPushToast(null), 8000)
  }, [])

  // Backgrounded: poll server on visibilitychange
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch('/api/push/last-target', { credentials: 'include' })
        if (!res.ok) return
        const { target } = await res.json() as { target: { sessionId: string; projectId: string | null; ts: number } | null }
        if (!target) return
        // Only act on pushes from the last 60 seconds
        if (Date.now() - target.ts > 60_000) return
        navigateToPushTarget(target.sessionId, target.projectId)
      } catch { /* ignore network errors */ }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [navigateToPushTarget])

  // Handle push notification taps: SW sends { type: 'switchSession', sessionId, projectId, url }
  // postMessage works on all platforms (iOS/Android) unlike client.navigate().
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'switchSession') return
      const targetSessionId = event.data.sessionId as string | undefined
      const targetProjectId = event.data.projectId as string | undefined
      const targetUrl = event.data.url as string | undefined
      if (!targetSessionId) return
      // If session is in the current project's list, switch directly (no reload)
      if (sessionsRef.current.some((s) => s.id === targetSessionId)) {
        setActiveSessionId(targetSessionId)
      } else if (targetProjectId) {
        // Session is in a different project — switch project first, then session.
        // The sessions-load effect will pick up pendingSessionIdRef and select it.
        pendingSessionIdRef.current = targetSessionId
        setActiveProjectId(targetProjectId)
      } else {
        // No project ID available — fall back to full navigation
        window.location.href = targetUrl ?? `/?session=${targetSessionId}`
      }
    }
    navigator.serviceWorker.addEventListener('message', handleMessage)
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage)
  }, [])

  // Check auth on mount
  useEffect(() => {
    getAuthStatus()
      .then(({ authenticated, hasCredentials: hasCreds }) => {
        setHasCredentials(hasCreds)
        setAuthState(authenticated ? 'authenticated' : 'unauthenticated')
      })
      .catch(() => setAuthState('unauthenticated'))
  }, [])

  async function handleAuthenticated() {
    setAuthState('authenticated')
    setHasCredentials(true)
  }

  async function handleLogout() {
    await logout()
    setAuthState('unauthenticated')
    setProjects([])
    setSessions([])
    setActiveProjectId(null)
    setActiveSessionId(null)
  }

  const handleReload = useCallback(() => {
    setRestarting(true)
    setTimeout(() => window.location.reload(), 1500)
  }, [])
  const { state: connState, lastSeenAt } = useAppConnection({
    onReload: authState === 'authenticated' ? handleReload : undefined,
    onPushTarget: handlePushTarget,
    onSchedulesChanged: () => setSchedulesTick((t) => t + 1),
    onArtifactUpdated: () => {
      setArtifactRefreshTick((t) => t + 1)
      // Re-fetch content for any currently-open artifact
      openArtifactsRef.current.forEach(({ artifact }) => {
        getArtifactContent(artifact.id).then((content) => {
          setOpenArtifacts((prev) =>
            prev.map((a) => a.artifact.id === artifact.id ? { ...a, content } : a)
          )
        }).catch(console.error)
      })
    },
  })

  // Load projects and meta once authenticated; restore last-used project if it still exists.
  // If a push notification tap supplied ?project=<id>, prefer that over localStorage so the
  // right project is active before the sessions effect runs.
  useEffect(() => {
    if (authState !== 'authenticated') return
    listProjects().then((loaded) => {
      setProjects(loaded)
      if (loaded.length > 0) {
        const pendingProjectId = pendingProjectIdRef.current
        const { projectId } = readLastState()
        const targetProjectId = pendingProjectId ?? projectId
        const restored = loaded.find((p) => p.id === targetProjectId)
        setActiveProjectId(restored ? restored.id : loaded[0].id)
      }
    }).catch(console.error)
    fetchMeta().then((m) => setAppRoot(m.appRoot)).catch(console.error)
  }, [authState])

  // Load sessions whenever the active project changes; restore last-used session if it still exists.
  // pendingSessionIdRef holds a ?session= param from a push notification tap — it takes priority
  // over localStorage. Skip the fetch when activeProjectId is null (project still loading) to avoid
  // a flash of all-session data before the real project run clears it.
  useEffect(() => {
    setLoading(true)
    setActiveSessionId(null)
    setSessions([])
    if (activeProjectId === null) {
      setLoading(false)
      return
    }
    listSessions(activeProjectId)
      .then((all) => {
        const compactedFromIds = new Set(all.map((s) => s.compacted_from).filter(Boolean))
        const data = all.filter((s) => !compactedFromIds.has(s.id))
        setSessions(data)
        if (data.length > 0) {
          const pendingId = pendingSessionIdRef.current
          const { sessionId } = readLastState()
          const targetId = pendingId ?? sessionId
          const restored = data.find((s) => s.id === targetId)
          if (restored) {
            setActiveSessionId(restored.id)
            pendingSessionIdRef.current = null
          } else {
            setActiveSessionId(data[0].id)
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [activeProjectId])

  async function handleSelectProject(id: string | null) {
    setActiveProjectId(id)
    setSidebarOpen(false)
  }

  async function handleCreateProject(name: string, path: string) {
    const project = await createProject(name, path)
    setProjects((prev) => [...prev, project])
    setActiveProjectId(project.id)
  }

  async function handlePermissionModeChange(sessionId: string, mode: import('./lib/api').PermissionMode) {
    const updated = await updatePermissionMode(sessionId, mode)
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)))
  }

  async function handleUpdateProjectSystemPrompt(projectId: string, systemPrompt: string | null) {
    const updated = await updateProject(projectId, { systemPrompt })
    setProjects((prev) => prev.map((p) => (p.id === projectId ? updated : p)))
  }

  async function handleDeleteProject(id: string) {
    await deleteProject(id)
    setProjects((prev) => {
      const remaining = prev.filter((p) => p.id !== id)
      if (activeProjectId === id) {
        setActiveProjectId(remaining.length > 0 ? remaining[0].id : null)
      }
      return remaining
    })
  }

  async function handleNewSession() {
    if (!activeProjectId) return
    try {
      const session = await createSession(activeProjectId)
      setSessions((prev) => [session, ...prev])
      setActiveSessionId(session.id)
      setSidebarOpen(false)
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

  const handleOpenArtifact = useCallback(async (artifact: Artifact) => {
    // If already open, just activate (and restore if minimized)
    if (openArtifactsRef.current.some((a) => a.artifact.id === artifact.id)) {
      setActiveArtifactId(artifact.id)
      setOpenArtifacts((prev) =>
        prev.map((a) => a.artifact.id === artifact.id ? { ...a, minimized: false } : a)
      )
      return
    }
    // Load content then add to open list
    const content = await getArtifactContent(artifact.id)
    setOpenArtifacts((prev) => [...prev, { artifact, content, minimized: false }])
    setActiveArtifactId(artifact.id)
  }, [])

  const handleCloseArtifact = useCallback((id: string) => {
    setOpenArtifacts((prev) => prev.filter((a) => a.artifact.id !== id))
    setActiveArtifactId((cur) => (cur === id ? null : cur))
  }, [])

  const handleMinimizeArtifact = useCallback((id: string) => {
    setOpenArtifacts((prev) =>
      prev.map((a) => a.artifact.id === id ? { ...a, minimized: true } : a)
    )
    setActiveArtifactId((cur) => (cur === id ? null : cur))
  }, [])

  const handleRestoreArtifact = useCallback((id: string) => {
    setOpenArtifacts((prev) =>
      prev.map((a) => a.artifact.id === id ? { ...a, minimized: false } : a)
    )
    setActiveArtifactId(id)
  }, [])

  const handleArtifactContentChange = useCallback((id: string, newContent: string) => {
    setOpenArtifacts((prev) =>
      prev.map((a) => a.artifact.id === id ? { ...a, content: newContent } : a)
    )
  }, [])

  const handleSaveArtifact = useCallback((id: string): Promise<void> => {
    const entry = openArtifactsRef.current.find((a) => a.artifact.id === id)
    if (!entry) return Promise.reject(new Error('Artifact not found in open list'))
    return putArtifactContent(id, entry.content)
  }, [])

  async function handleCompact(_newSessionId: string) {
    if (!activeProjectId) return
    // Refresh sidebar — but filter out past chain segments (sessions whose id is
    // referenced as compacted_from by another session). They appear in the ChatWindow
    // chain view instead, so showing them in the sidebar is redundant and confusing.
    const updated = await listSessions(activeProjectId)
    const compactedFromIds = new Set(updated.map((s) => s.compacted_from).filter(Boolean))
    setSessions(updated.filter((s) => !compactedFromIds.has(s.id)))
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

  // Persist last-used project + session so we can restore them on next load.
  // Only save when we have a real project (skip the null state during loading transitions).
  useEffect(() => {
    if (activeProjectId && activeSessionId) saveLastState(activeProjectId, activeSessionId)
  }, [activeProjectId, activeSessionId])

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const mobileTitle = activeSession?.title ?? activeProject?.name ?? 'Claude Steward'

  if (authState === 'loading') {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#0d0d0d]">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-[#333] border-t-[#666]" />
      </div>
    )
  }

  if (authState === 'unauthenticated') {
    return <AuthPage hasCredentials={hasCredentials} onAuthenticated={handleAuthenticated} />
  }

  return (
    <ErrorBoundary onError={pushError}>
    <div className="flex h-dvh relative overflow-hidden bg-[#0d0d0d] text-[#e8e8e8]">
      {/* Client error console — unhandled JS exceptions and React render errors */}
      <ErrorConsole
        errors={clientErrors}
        onDismiss={(id) => setClientErrors((prev) => prev.filter((e) => e.id !== id))}
        onClearAll={() => setClientErrors([])}
      />

      {/* Push notification toast — shown when a push arrives while the app is in the foreground */}
      {pushToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9998] max-w-sm w-[calc(100%-2rem)] animate-in">
          <button
            onClick={() => {
              setPushToast(null)
              if (pushToastTimerRef.current) clearTimeout(pushToastTimerRef.current)
              navigateToPushTarget(pushToast.sessionId, pushToast.projectId)
            }}
            className="w-full bg-[#1a1a1a] border border-[#333] rounded-xl px-4 py-3 shadow-2xl cursor-pointer hover:border-[#555] transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[#e8e8e8] truncate flex-1">{pushToast.title}</span>
              <span
                onClick={(e) => { e.stopPropagation(); setPushToast(null); if (pushToastTimerRef.current) clearTimeout(pushToastTimerRef.current) }}
                className="text-[#555] hover:text-[#888] text-xs flex-shrink-0 px-1"
              >✕</span>
            </div>
            {pushToast.body && <div className="text-xs text-[#aaa] mt-1 line-clamp-2">{pushToast.body}</div>}
            <div className="text-[11px] text-[#666] mt-1">Tap to switch session</div>
          </button>
        </div>
      )}

      {/* Restart overlay */}
      {restarting && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-[9999] text-lg font-semibold text-[#e8e8e8] tracking-wide">
          <p>Restarting…</p>
        </div>
      )}

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed overlay on mobile, inline on desktop */}
      <div className={`fixed inset-y-0 left-0 z-50 flex-shrink-0 transition-transform duration-200
        md:relative md:z-auto md:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <SessionSidebar
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={handleSelectProject}
          onCreateProject={handleCreateProject}
          onDeleteProject={handleDeleteProject}
          onUpdateProjectSystemPrompt={handleUpdateProjectSystemPrompt}
          protectedProjectPath={appRoot}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={(id) => { setActiveSessionId(id); setSidebarOpen(false) }}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
          onDeleteAllSessions={handleDeleteAllSessions}
          onRenameSession={handleRenameSession}
          loading={loading}
          onClose={() => setSidebarOpen(false)}
          onLogout={handleLogout}
          connState={connState}
          lastSeenAt={lastSeenAt}
          onOpenApp={(url, name) => setAppPanel({ url, name })}
          onOpenArtifact={handleOpenArtifact}
          artifactRefreshTick={artifactRefreshTick}
        />
      </div>

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden min-w-0">
        {/* Chat column */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Mobile header bar */}
          <div className="flex items-center gap-2 h-11 px-2 border-b border-[#1f1f1f] md:hidden flex-shrink-0 bg-[#0d0d0d]">
            <button
              onClick={() => setSidebarOpen(true)}
              className="w-11 h-11 flex items-center justify-center text-[#666] hover:text-[#aaa] text-xl flex-shrink-0"
              aria-label="Open sidebar"
            >
              ☰
            </button>
            <ConnectionDot state={connState} lastSeenAt={lastSeenAt} />
            <span className="flex-1 text-sm text-[#888] truncate text-center">
              {mobileTitle}
            </span>
            <button
              onClick={() => window.location.reload()}
              className="w-11 h-11 flex items-center justify-center text-[#555] hover:text-[#aaa] flex-shrink-0"
              title="Refresh"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
            <button
              onClick={handleLogout}
              className="w-11 h-11 flex items-center justify-center text-[#555] hover:text-[#aaa] flex-shrink-0"
              title="Sign out"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
            </button>
          </div>

          {activeSessionId ? (
            <ChatWindow
              key={activeSessionId}
              sessionId={activeSessionId}
              systemPrompt={sessions.find((s) => s.id === activeSessionId)?.system_prompt ?? null}
              permissionMode={sessions.find((s) => s.id === activeSessionId)?.permission_mode ?? 'acceptEdits'}
              timezone={sessions.find((s) => s.id === activeSessionId)?.timezone ?? null}
              model={sessions.find((s) => s.id === activeSessionId)?.model ?? null}
              claudeSessionId={sessions.find((s) => s.id === activeSessionId)?.claude_session_id ?? null}
              projectId={activeProjectId}
              onTitle={(title) => handleTitleUpdate(activeSessionId, title)}
              onActivity={() => handleSessionActivity(activeSessionId)}
              onSystemPromptChange={(prompt) =>
                setSessions((prev) =>
                  prev.map((s) => s.id === activeSessionId ? { ...s, system_prompt: prompt } : s)
                )
              }
              onPermissionModeChange={(mode) => handlePermissionModeChange(activeSessionId, mode)}
              onModelChange={(newModel) =>
                setSessions((prev) =>
                  prev.map((s) => s.id === activeSessionId ? { ...s, model: newModel } : s)
                )
              }
              onCompact={handleCompact}
              schedulesTick={schedulesTick}
              artifactRefreshTick={artifactRefreshTick}
              onOpenArtifact={handleOpenArtifact}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-[#666]">
              {activeProjectId ? (
                <>
                  <p>No sessions in this project yet.</p>
                  <button
                    className="bg-blue-600 hover:bg-blue-700 text-white border-none px-6 py-2.5 rounded-lg cursor-pointer text-[15px] transition-colors"
                    onClick={handleNewSession}
                  >
                    New Chat
                  </button>
                </>
              ) : (
                <p>Create a project to start chatting.</p>
              )}
            </div>
          )}
        </div>

        {/* Artifact float panel — fixed right overlay, does not push content */}
        <ArtifactFloat
          openArtifacts={openArtifacts}
          activeArtifactId={activeArtifactId}
          projectId={activeProjectId}
          onActivate={setActiveArtifactId}
          onClose={handleCloseArtifact}
          onMinimize={handleMinimizeArtifact}
          onRestore={handleRestoreArtifact}
          onContentChange={handleArtifactContentChange}
          onSave={handleSaveArtifact}
        />

        {/* App view panel — mobile: full-screen overlay; desktop: side column */}
        {appPanel && (
          <AppViewPanel
            url={appPanel.url}
            name={appPanel.name}
            preset={appPanelPreset}
            onPresetChange={setAppPanelPreset}
            onClose={() => setAppPanel(null)}
          />
        )}
      </main>
    </div>
    </ErrorBoundary>
  )
}
