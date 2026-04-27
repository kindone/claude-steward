import { useState, useEffect, useRef, useCallback } from 'react'
import { sendMessage, stopChat, getMessages, watchSession, subscribeToSession, updateSystemPrompt, updatePermissionMode, updateSessionModel, updateSessionCli, compactSession, getSessionChain, updateSessionTimezone, listArtifacts, createArtifact, deriveArtifactName, toolDisplayName, toolDisplayDetail, fetchMeta, type ChainSegment, type ClaudeErrorCode, type PermissionMode, type ToolCall, type Message as ApiMessage, type UsageInfo, type Artifact, type ArtifactType, type ModelOption, type CliName, type AdapterInfo } from '../lib/api'
import { CompactDivider } from './CompactDivider'

const MODES: { value: PermissionMode; label: string; title: string }[] = [
  { value: 'plan',              label: 'Plan', title: 'Read-only — Claude can analyse but not edit or run commands' },
  { value: 'acceptEdits',       label: 'Edit', title: 'Claude can read and write files but not run shell commands' },
  { value: 'bypassPermissions', label: 'Full', title: 'Claude can run any tool including shell commands' },
]

/**
 * Fallback model list used until /api/meta replies (or if it omits `models`,
 * which can happen when an older server build is rolling out). Mirrors the
 * Claude adapter's curated list — that's the production default since
 * STEWARD_CLI defaults to `claude`.
 *
 * The runtime list comes from the active CliAdapter on the server, so a
 * STEWARD_CLI=opencode deployment will see opencode `provider/model` slugs
 * here as soon as the meta fetch resolves.
 */
const FALLBACK_MODEL_OPTIONS: ModelOption[] = [
  { value: null,                 label: 'Default' },
  { value: 'claude-opus-4-6',    label: 'Opus 4.6' },
  { value: 'claude-sonnet-4-6',  label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-5',    label: 'Opus 4.5' },
  { value: 'claude-sonnet-4-5',  label: 'Sonnet 4.5' },
  { value: 'claude-haiku-4-5',   label: 'Haiku 4.5' },
]
import { MessageBubble } from './MessageBubble'
import { MessageInput } from './MessageInput'
import { SchedulePanel } from './SchedulePanel'
import { KernelSelector } from './KernelSelector'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming: boolean
  errorCode?: ClaudeErrorCode
  source?: string | null
  /** Tool calls made while generating this message, in invocation order. */
  toolUses?: ToolCall[]
  createdAt?: number
}

function dbMessageToLocal(m: ApiMessage): Message {
  let toolUses: ToolCall[] | undefined
  if (m.tool_calls) {
    try { toolUses = JSON.parse(m.tool_calls) as ToolCall[] } catch { /* ignore */ }
  }
  return {
    ...m,
    streaming: m.status === 'streaming',
    errorCode: m.status === 'interrupted'
      ? (m.error_code as ClaudeErrorCode ?? 'process_error')
      : m.is_error ? (m.error_code as ClaudeErrorCode ?? 'process_error') : undefined,
    source: m.source,
    toolUses,
    createdAt: m.created_at,
  }
}

/** Format a Unix timestamp (seconds) as a date label, e.g. "April 5" or "Today" / "Yesterday". */
function formatDateLabel(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
}

/** Small inline component: shows a monospace ID with a copy button. */
function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="flex items-center gap-1">
      <code className="text-[11px] font-mono text-app-text-5 bg-app-bg-raised px-1.5 py-0.5 rounded select-all">{value}</code>
      <button
        className="bg-transparent border-none cursor-pointer text-app-text-7 hover:text-app-text-4 text-[11px] px-1 transition-colors"
        onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
        title="Copy"
      >
        {copied ? '✓' : '⎘'}
      </button>
    </span>
  )
}

type Props = {
  sessionId: string
  systemPrompt: string | null
  permissionMode: PermissionMode
  timezone?: string | null
  model?: string | null
  cli?: CliName
  claudeSessionId?: string | null
  projectId?: string | null
  onTitle?: (title: string) => void
  onActivity?: () => void
  onSystemPromptChange?: (prompt: string | null) => void
  onPermissionModeChange?: (mode: PermissionMode) => void
  onModelChange?: (model: string | null) => void
  /** Called after a successful CLI switch — the parent should refresh its
   *  Session record (model + claude_session_id are cleared server-side as
   *  part of the same transaction). */
  onCliChange?: (cli: CliName) => void
  onCompact?: (newSessionId: string) => void
  /** Incremented by App when the server emits a schedules_changed SSE event. */
  schedulesTick?: number
  /** Incremented by App when an artifact SSE event fires, so MessageInput suggestions stay fresh. */
  artifactRefreshTick?: number
  /** Called when a saved artifact should be opened in the float panel. */
  onOpenArtifact?: (artifact: Artifact) => void
}

export function ChatWindow({ sessionId, systemPrompt, permissionMode, timezone, model, cli, claudeSessionId, projectId, onTitle, onActivity, onSystemPromptChange, onPermissionModeChange, onModelChange, onCliChange, onCompact, schedulesTick = 0, artifactRefreshTick, onOpenArtifact }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingSession, setLoadingSession] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamingTool, setStreamingTool] = useState<string | null>(null)
  const [focusTrigger, setFocusTrigger] = useState(0)
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState(systemPrompt ?? '')
  const [compacting, setCompacting] = useState(false)
  const [compactError, setCompactError] = useState<string | null>(null)
  const [lastUsage, setLastUsage] = useState<UsageInfo | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleTick, setScheduleTick] = useState(0)
  const [debugOpen, setDebugOpen] = useState(false)
  const [chainInfoOpen, setChainInfoOpen] = useState(false)
  const [kernelRefreshTick, setKernelRefreshTick] = useState(0)
  // Artifacts for @mention autocomplete in MessageInput
  const [projectArtifacts, setProjectArtifacts] = useState<Artifact[]>([])
  // Per-adapter info bundle (models + capabilities), fetched once on mount
  // from /api/meta. Keyed by CLI name. Empty until the fetch resolves;
  // model dropdown falls back to FALLBACK_MODEL_OPTIONS in that window.
  const [adapters, setAdapters] = useState<Partial<Record<CliName, AdapterInfo>>>({})
  // Default CLI surfaced by /api/meta — used for the dropdown selector when
  // the session itself doesn't yet have an explicit `cli` field (older
  // server builds that pre-date per-session-cli).
  const [defaultCli, setDefaultCli] = useState<CliName | undefined>(undefined)
  // The CLI picker reads from `cli` (prop, kept fresh by the parent) when
  // present, else falls back to the meta `defaultCli`.
  const effectiveCli: CliName | undefined = cli ?? defaultCli
  // Model options for the picker reflect the *session's* adapter, not the
  // deploy-default. Falls back to the legacy single-list shape if the
  // server hasn't shipped the `adapters` bundle yet.
  const modelOptions: ModelOption[] = (effectiveCli && adapters[effectiveCli]?.models) ?? FALLBACK_MODEL_OPTIONS
  // Past segments: frozen messages from compacted predecessors, shown above dividers.
  const [pastSegments, setPastSegments] = useState<(ChainSegment & { messages: Message[] })[]>([])
  // The tail session this ChatWindow is currently sending to (may differ from sessionId prop after compact).
  const [currentSessionId, setCurrentSessionId] = useState(sessionId)
  // Ref-only bottom tracking — avoids React re-renders on scroll settle (which caused
  // mobile stutter by interrupting momentum deceleration). Button visibility is toggled
  // via direct DOM class manipulation instead.
  const isAtBottomRef = useRef(true)
  const scrollBtnRef = useRef<HTMLButtonElement>(null)
  const setIsAtBottom = (v: boolean) => {
    isAtBottomRef.current = v
    const btn = scrollBtnRef.current
    if (!btn) return
    if (v) {
      btn.classList.add('opacity-0', 'invisible')
      btn.classList.remove('opacity-100', 'visible')
    } else {
      btn.classList.remove('opacity-0', 'invisible')
      btn.classList.add('opacity-100', 'visible')
    }
  }
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  /** 'instant' on first load, 'smooth' during streaming, 'none' when prepending older messages. */
  const scrollBehaviorRef = useRef<'instant' | 'smooth' | 'none'>('instant')
  /** Tracks whether the scroll container was at the bottom before the last messages update.
   *  Updated by a scroll listener so it reflects pre-render state, not post-render distance. */
  const wasAtBottomRef = useRef(true)
  /** True while the user is actively scrolling (including iOS momentum deceleration).
   *  Detected via a 150ms debounce on scroll events — more reliable than touchend, which
   *  fires before momentum ends. Auto-scroll is suppressed while this is true. */
  const userIsScrollingRef = useRef(false)
  const scrollSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Set to true before a programmatic scrollTop change so the resulting scroll event
   *  doesn't incorrectly mark the user as scrolling and block streaming auto-scroll. */
  const skipNextScrollRef = useRef(false)
  const cancelRef = useRef<(() => void) | null>(null)
  const prevStreamingRef = useRef(false)

  // Re-focus input whenever streaming transitions true → false
  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      setFocusTrigger((t) => t + 1)
    }
    prevStreamingRef.current = streaming
  }, [streaming])
  /** True while we have an active sendMessage() — poll must not overwrite the optimistic assistant bubble. */
  const streamingFromSendRef = useRef(false)
  /** Accumulates tool calls (with detail) as assistant chunks arrive during the current send. */
  const toolUsesRef = useRef<ToolCall[]>([])
  /** Accumulates tool results keyed by tool_use_id during the current send. */
  const toolResultsRef = useRef<Map<string, { output: string; isError: boolean }>>(new Map())
  /** Live copy of toolUsesRef for rendering the streaming indicator. */
  const [streamingToolUses, setStreamingToolUses] = useState<ToolCall[]>([])

  // Sync draft when switching sessions
  useEffect(() => {
    setPromptDraft(systemPrompt ?? '')
    setPromptOpen(false)
  }, [sessionId, systemPrompt])

  // Fetch the adapter bundle from /api/meta. Mount-only — the supported
  // adapter set + their models don't change without a server redeploy.
  // Errors are non-fatal: the modelOptions selector falls back to the
  // FALLBACK list when adapters/effectiveCli aren't populated yet.
  useEffect(() => {
    fetchMeta().then((m) => {
      if (m.adapters) setAdapters(m.adapters)
      if (m.defaultCli) setDefaultCli(m.defaultCli)
      // Legacy single-adapter fallback: pre-Phase-1 servers only return
      // `cli` + `models`. Materialise that into the adapters bundle so the
      // selector still finds something to render against.
      else if (m.cli && m.models) {
        setAdapters({ [m.cli]: { models: m.models, capabilities: { streamingTokens: true, toolUseStructured: true, supportsMcp: true, branchResume: true } } } as Partial<Record<CliName, AdapterInfo>>)
        setDefaultCli(m.cli)
      }
    }).catch(() => { /* keep fallback */ })
  }, [])

  // Send browser timezone to server on session open so Claude can use it for scheduling
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz) updateSessionTimezone(sessionId, tz).catch(() => {})
    } catch { /* ignore */ }
  }, [sessionId])

  // Fetch artifacts for @mention autocomplete; re-fetch when projectId or artifactRefreshTick changes
  useEffect(() => {
    if (!projectId) { setProjectArtifacts([]); return }
    listArtifacts(projectId).then(setProjectArtifacts).catch(() => {})
  }, [projectId, artifactRefreshTick])

  async function handlePromptSave() {
    const value = promptDraft.trim() || null
    await updateSystemPrompt(sessionId, value)
    onSystemPromptChange?.(value)
    setPromptOpen(false)
  }

  async function handleModeChange(mode: PermissionMode) {
    await updatePermissionMode(sessionId, mode)
    onPermissionModeChange?.(mode)
  }

  async function handleModelChange(value: string | null) {
    await updateSessionModel(sessionId, value)
    onModelChange?.(value)
  }

  async function handleCliChange(value: CliName) {
    if (value === effectiveCli) return  // no-op, server would noop too
    // Switching adapter is destructive on the server (clears claude_session_id
    // and model). Confirm so the user knows their visible chat history stays
    // but the CLI's view of the conversation resets.
    const confirmed = window.confirm(
      `Switching to ${value} will reset the conversation context from the CLI's perspective.\n\n` +
      `Your visible message history stays, but the new CLI will treat the next message as the start of a fresh conversation. ` +
      `The model selection also clears (slug formats differ between adapters).\n\n` +
      `Continue?`,
    )
    if (!confirmed) return
    await updateSessionCli(sessionId, value)
    onCliChange?.(value)
    // Server cleared model as part of the same transaction; reflect locally.
    onModelChange?.(null)
  }

  function handlePromptKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setPromptDraft(systemPrompt ?? ''); setPromptOpen(false) }
  }

  async function handleCompact() {
    setCompacting(true)
    setCompactError(null)
    try {
      const { sessionId: newId, summary } = await compactSession(currentSessionId)

      // Snapshot current tail as a frozen past segment
      const newSegment: ChainSegment & { messages: Message[] } = {
        id: currentSessionId,
        title: '[Compacted Session]',
        claude_session_id: null,
        project_id: null,
        system_prompt: null,
        permission_mode: 'acceptEdits',
        timezone: null,
        model: null,
        compacted_from: null,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
        compactSummary: summary,
        messages: [...messages],
      }
      setPastSegments((prev) => [...prev, newSegment])
      setCurrentSessionId(newId)
      setMessages([])
      setHasMore(false)

      // Notify App to add the new session to the sidebar (no re-mount — no setActiveSessionId)
      onCompact?.(newId)
    } catch (err) {
      console.error('[compact] failed:', err)
      setCompactError(err instanceof Error ? err.message : 'Compact failed')
    } finally {
      setCompacting(false)
    }
  }

  // Track wasAtBottomRef synchronously on every scroll event (ref-only, no re-renders).
  // isAtBottom state (for the button) is updated only after scrolling fully settles (150ms
  // of no events) — piggybacking on the same debounce timer as userIsScrollingRef.
  // This replaces the previous IntersectionObserver approach: the IO was oscillating when
  // bottomRef sat exactly at its rootMargin threshold, causing rapid setIsAtBottom flips
  // that triggered re-renders → micro layout shifts → more IO firings → loop.
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const onScroll = () => {
      // Ignore the scroll event fired by our own programmatic scrollTop assignment
      // (e.g. the scroll-to-bottom button click). Without this, the event would set
      // userIsScrollingRef=true for 150ms, blocking streaming auto-scroll and causing
      // the view to drift up from the bottom as new content arrived.
      if (skipNextScrollRef.current) {
        skipNextScrollRef.current = false
        return
      }
      userIsScrollingRef.current = true
      if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current)
      scrollSettleTimerRef.current = setTimeout(() => {
        userIsScrollingRef.current = false
        // Update button visibility only after scroll physics have fully settled.
        // No re-render fires during active scrolling, so iOS momentum is never interrupted.
        const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50
        setIsAtBottom(atBottom)
      }, 150)

      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50
      wasAtBottomRef.current = atBottom
    }
    // On orientation change / window resize, re-snap to bottom if the user
    // was already there — the viewport flip changes clientHeight which shifts
    // the effective scroll position away from the bottom.
    const onResize = () => {
      if (wasAtBottomRef.current && !userIsScrollingRef.current) {
        skipNextScrollRef.current = true
        container.scrollTop = 1e9
      }
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      container.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (messages.length === 0) return
    const behavior = scrollBehaviorRef.current
    if (behavior === 'none') {
      // loadOlder prepended messages — don't scroll, position already restored by loadOlder
      scrollBehaviorRef.current = 'smooth'
      return
    }
    if (behavior === 'instant') {
      // Initial load: snap to absolute bottom.
      // Flag the scroll event as programmatic so it doesn't set userIsScrollingRef.
      const container = scrollContainerRef.current
      if (container) {
        skipNextScrollRef.current = true
        container.scrollTop = 1e9
      }
      scrollBehaviorRef.current = 'smooth'
      // Async content (mermaid SVGs, images, KaTeX) may increase scrollHeight after
      // this initial snap. Poll scrollHeight via rAF for a short window — whenever it
      // grows, re-snap to bottom. rAF runs after layout so scrollHeight is accurate.
      if (container) {
        let lastH = container.scrollHeight
        const deadline = performance.now() + 5000
        const check = () => {
          if (userIsScrollingRef.current || performance.now() > deadline) return
          if (container.scrollHeight !== lastH) {
            lastH = container.scrollHeight
            skipNextScrollRef.current = true
            container.scrollTop = 1e9
          }
          requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      }
    } else {
      // New content: scroll to bottom only if user was already there and not actively scrolling
      if (wasAtBottomRef.current && !userIsScrollingRef.current) {
        const container = scrollContainerRef.current
        if (container) container.scrollTop = 1e9
      }
    }
  }, [messages])

  useEffect(() => {
    streamingFromSendRef.current = false
    let cancelled = false
    let cancelWatch: (() => void) | null = null

    // Reset scroll to snap-to-bottom on every session load/switch
    scrollBehaviorRef.current = 'instant'

    // Reset chain state when root session changes
    setLoadingSession(true)
    setPastSegments([])
    setCurrentSessionId(sessionId)

    // Load the full chain (in case this session is the tail of a compacted chain)
    getSessionChain(sessionId).then(async (chain) => {
      if (cancelled || chain.length === 0) return
      const tail = chain[chain.length - 1]
      const tailId = tail.id
      if (!cancelled) setCurrentSessionId(tailId)

      // Load messages for all past segments (frozen — no pagination needed)
      if (chain.length > 1) {
        const past = await Promise.all(
          chain.slice(0, -1).map(async (seg) => {
            const page = await getMessages(seg.id, { limit: 200 })
            return { ...seg, messages: page.messages.map(dbMessageToLocal) }
          })
        )
        if (!cancelled) setPastSegments(past)
      }
    }).catch(() => { /* chain endpoint may not exist for older sessions — ignore */ })

    // Persistent subscription on the tail session
    const cancelSubscription = subscribeToSession(sessionId, async () => {
      if (cancelled || streamingFromSendRef.current) return
      try {
        const fresh = await getMessages(sessionId)
        setMessages(fresh.messages.map(dbMessageToLocal))
        setHasMore(fresh.hasMore)
        setScheduleTick((t) => t + 1)
      } catch { /* ignore */ }
    })

    getMessages(sessionId).then((page) => {
      if (cancelled) return
      setMessages(page.messages.map(dbMessageToLocal))
      setHasMore(page.hasMore)
      setLoadingSession(false)
      // Show spinner and watch for completion if:
      // - last message is from the user (Claude hasn't responded yet), OR
      // - last message is a streaming assistant message (in-progress, possibly partial content)
      const last = page.messages[page.messages.length - 1]
      const inProgress = last && (
        last.role === 'user' ||
        (last.role === 'assistant' && last.status === 'streaming')
      )
      if (inProgress) {
        setStreaming(true)
        cancelWatch = watchSession(
          sessionId,
          async () => {
            if (cancelled) return
            try {
              const fresh = await getMessages(sessionId)
              setMessages(fresh.messages.map(dbMessageToLocal))
              setHasMore(fresh.hasMore)
            } finally {
              setStreaming(false)
            }
          },
          () => { if (!cancelled) setStreaming(false) },
        )
      }
    }).catch(() => { setLoadingSession(false) /* session may be new — ignore */ })

    return () => {
      cancelled = true
      cancelRef.current?.()
      cancelWatch?.()
      cancelSubscription()
    }
  }, [sessionId])

  // Re-fetch messages when the page becomes visible again (e.g. mobile app
  // backgrounded and resumed, or tab switched away and back). Skipped while
  // an active send is streaming so the optimistic bubble isn't overwritten.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== 'visible') return
      if (streamingFromSendRef.current) return
      getMessages(sessionId).then((page) => {
        setMessages((prev) => {
          const lastPrevId = prev[prev.length - 1]?.id
          const lastNewId = page.messages[page.messages.length - 1]?.id
          if (lastNewId === lastPrevId) return prev  // nothing new — skip re-render
          return page.messages.map(dbMessageToLocal)
        })
        setHasMore(page.hasMore)
      }).catch(() => {})
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [sessionId])

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || messages.length === 0) return
    const oldestId = messages[0].id
    setLoadingOlder(true)
    try {
      const page = await getMessages(currentSessionId, { before: oldestId })
      if (page.messages.length === 0) { setHasMore(false); return }
      // Save scroll anchor so prepending doesn't jump to bottom
      const container = scrollContainerRef.current
      const prevScrollHeight = container?.scrollHeight ?? 0
      scrollBehaviorRef.current = 'none'
      setMessages((prev) => [...page.messages.map(dbMessageToLocal), ...prev])
      setHasMore(page.hasMore)
      // Restore position: shift scrollTop by the new content height added above
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop += container.scrollHeight - prevScrollHeight
        }
      })
    } catch (err) {
      console.error('Failed to load older messages', err)
    } finally {
      setLoadingOlder(false)
    }
  }, [sessionId, hasMore, loadingOlder, messages])

  const handleSaveAsArtifact = useCallback(async (
    content: string,
    defaultType: ArtifactType,
    defaultName: string,
    _anchorEl: HTMLElement,
    language?: string
  ) => {
    if (!projectId) return
    const name = defaultName || deriveArtifactName(content, '', defaultType)
    const metadata = defaultType === 'code' && language ? { language } : undefined
    try {
      const artifact = await createArtifact(projectId, {
        name,
        type: defaultType,
        content,
        metadata,
        created_from_session: sessionId,
      })
      onOpenArtifact?.(artifact)
    } catch (e) {
      console.error('Failed to save artifact', e)
    }
  }, [projectId, sessionId, onOpenArtifact])

  function generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
  }

  function handleSend(text: string) {
    const userMsgId = generateId()
    const assistantMsgId = generateId()

    streamingFromSendRef.current = true
    toolUsesRef.current = []
    toolResultsRef.current = new Map()
    setStreamingTool(null)
    setStreamingToolUses([])
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: text, streaming: false },
      { id: assistantMsgId, role: 'assistant', content: '', streaming: true },
    ])
    setStreaming(true)

    cancelRef.current = sendMessage(currentSessionId, text, {
      onTitle,
      onActivity,
      onUsage: (usage) => setLastUsage(usage),
      onTextDelta: (delta) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: m.content + delta } : m
          )
        )
      },
      onToolActivity: (toolName) => {
        setStreamingTool(toolName)
      },
      onToolCall: (call) => {
        toolUsesRef.current = [...toolUsesRef.current, call]
        setStreamingToolUses([...toolUsesRef.current])
      },
      onToolResult: (toolUseId, output, isError) => {
        toolResultsRef.current.set(toolUseId, { output, isError })
      },
      onDone: () => {
        streamingFromSendRef.current = false
        setStreamingTool(null)
        const capturedToolUses = toolUsesRef.current.length > 0
          ? toolUsesRef.current.map((call) => {
              const result = toolResultsRef.current.get(call.id)
              return result ? { ...call, output: result.output, isError: result.isError } : call
            })
          : undefined
        setStreamingToolUses([])
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, streaming: false, toolUses: capturedToolUses } : m
          )
        )
        setStreaming(false)
      },
      onError: (_errorMsg, code) => {
        streamingFromSendRef.current = false
        setStreamingTool(null)
        setStreamingToolUses([])
        if (code === 'connection_lost') {
          // Server restarted mid-stream — don't mark as error yet.
          // The worker is likely still running; switch to watchSession and wait for recovery.
          cancelRef.current = watchSession(
            currentSessionId,
            async () => {
              try {
                const fresh = await getMessages(currentSessionId)
                setMessages(fresh.messages.map(dbMessageToLocal))
                setHasMore(fresh.hasMore)
              } finally {
                setStreaming(false)
              }
            },
            () => {
              // watchSession itself failed — fall back to error
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, streaming: false, errorCode: 'process_error' } : m
                )
              )
              setStreaming(false)
            },
          )
          return
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, streaming: false, errorCode: code }
              : m
          )
        )
        setStreaming(false)
      },
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Session header: system prompt toggle + permission mode selector */}
      <div className="flex-shrink-0 border-b border-app-bg-card">
        <div className="flex items-center justify-between px-2">
          <span className="flex items-center gap-1">
            <button
              className={`bg-transparent border-none cursor-pointer text-xs py-1.5 px-1.5 text-left transition-colors flex-shrink-0
                ${systemPrompt ? 'text-blue-500 hover:text-blue-400' : 'text-app-text-7 hover:text-app-text-4'}`}
              onClick={() => setPromptOpen((o) => !o)}
              title="System prompt"
            >
              ⚙<span className="hidden sm:inline"> {systemPrompt ? 'Prompt set' : 'Prompt'}</span>
            </button>
            <button
              className={`bg-transparent border-none cursor-pointer text-xs py-1.5 px-1 transition-colors flex-shrink-0 ${debugOpen ? 'text-app-text-5' : 'text-app-border-3 hover:text-app-text-6'}`}
              onClick={() => setDebugOpen((o) => !o)}
              title="Session debug info"
            >
              ℹ
            </button>
          </span>

          <span className="flex items-center gap-1 sm:gap-2">
            {/* Kernel selector — shown when project has live kernels */}
            {projectId && (
              <KernelSelector projectId={projectId} refreshTick={kernelRefreshTick} />
            )}

            {/* Schedule button */}
            <button
              className={`bg-transparent border border-app-bg-hover hover:border-app-border-4 rounded cursor-pointer text-xs px-2.5 py-1.5 transition-colors ${scheduleOpen ? 'text-blue-400 border-blue-500/40' : 'text-app-text-7 hover:text-app-text-4'}`}
              onClick={() => setScheduleOpen((o) => !o)}
              title="Scheduled prompts"
            >
              ⏰<span className="hidden sm:inline"> Schedule</span>
            </button>

            {/* Chain info button — shown when this session is part of a compacted chain */}
            {pastSegments.length > 0 && (
              <button
                className={`bg-transparent border border-app-bg-hover hover:border-app-border-4 rounded cursor-pointer text-xs px-2 py-1.5 transition-colors ${chainInfoOpen ? 'text-blue-400 border-blue-500/40' : 'text-app-text-7 hover:text-app-text-4'}`}
                onClick={() => setChainInfoOpen((o) => !o)}
                title="Session chain — this conversation spans multiple compacted sessions"
              >
                ⊡ {pastSegments.length + 1}
              </button>
            )}

            {/* Compact button */}
            <button
              className={`bg-transparent border border-app-bg-hover hover:border-app-border-4 rounded text-app-text-7 hover:text-app-text-4 cursor-pointer text-xs px-2.5 py-1.5 transition-colors ${(compacting || streaming) ? 'opacity-40 cursor-default' : ''}`}
              onClick={handleCompact}
              disabled={compacting || streaming}
              title="Summarize this session and start fresh — resets the context window"
            >
              <span className="sm:hidden">⊡</span>
              <span className="hidden sm:inline">{compacting ? 'Compacting…' : '⊡ Compact'}</span>
            </button>

            {/* Permission mode segmented control */}
            <span className="inline-flex border border-app-bg-hover rounded overflow-hidden">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  className={`bg-transparent border-r border-app-bg-hover last:border-r-0 cursor-pointer text-xs px-2 sm:px-3 py-2 transition-colors
                    ${permissionMode === m.value
                      ? 'bg-app-blue-tint text-blue-400'
                      : 'text-app-text-7 hover:bg-app-bg-card hover:text-app-text-4'}`}
                  onClick={() => handleModeChange(m.value)}
                  title={m.title}
                >
                  <span className="sm:hidden">{m.label.charAt(0)}</span>
                  <span className="hidden sm:inline">{m.label}</span>
                </button>
              ))}
            </span>
          </span>
        </div>

        {/* Token usage row — full width, only shown after a response */}
        {lastUsage && (() => {
          const ctx = lastUsage.input_tokens + (lastUsage.cache_read_input_tokens ?? 0) + (lastUsage.cache_creation_input_tokens ?? 0)
          const titleParts = [
            `ctx: ${ctx.toLocaleString()} (${lastUsage.input_tokens.toLocaleString()} new` +
              (lastUsage.cache_read_input_tokens ? ` + ${lastUsage.cache_read_input_tokens.toLocaleString()} cached` : '') +
              (lastUsage.cache_creation_input_tokens ? ` + ${lastUsage.cache_creation_input_tokens.toLocaleString()} created` : '') +
            `)`,
            `out: ${lastUsage.output_tokens.toLocaleString()}`,
            lastUsage.total_cost_usd != null ? `$${lastUsage.total_cost_usd.toFixed(4)}` : null,
          ].filter(Boolean).join(' · ')
          return (
            <div className="flex items-center gap-2 px-3 pb-1">
              <span className="text-[11px] text-app-text-7 tabular-nums" title={titleParts}>
                {ctx.toLocaleString()} ctx · {lastUsage.output_tokens.toLocaleString()} out
                {lastUsage.total_cost_usd != null && (
                  <span className="ml-1.5 text-app-border-3">${lastUsage.total_cost_usd.toFixed(4)}</span>
                )}
              </span>
            </div>
          )
        })()}

        {debugOpen && (
          <div className="px-3 pb-2 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-app-text-7 w-28 flex-shrink-0">claude_session_id</span>
              {claudeSessionId ? (
                <CopyableId value={claudeSessionId} />
              ) : (
                <span className="text-[11px] text-app-border-3 italic">none (not yet sent)</span>
              )}
            </div>
            {/* CLI adapter picker — only render when the server actually
                advertises more than one adapter. Single-adapter deploys
                (no `adapters` bundle in /api/meta, or just one entry) hide
                the row to avoid a useless control. */}
            {Object.keys(adapters).length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-app-text-7 w-28 flex-shrink-0">CLI</span>
                <select
                  className="bg-app-bg border border-app-bg-hover hover:border-app-border-4 rounded text-app-text-4 cursor-pointer text-xs px-2 py-1 transition-colors outline-none"
                  value={effectiveCli ?? ''}
                  onChange={(e) => { void handleCliChange(e.target.value as CliName) }}
                  title="CLI adapter for this session — switching resets the CLI's view of the conversation"
                >
                  {(Object.keys(adapters) as CliName[]).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-app-text-7 w-28 flex-shrink-0">model</span>
              <select
                className="bg-app-bg border border-app-bg-hover hover:border-app-border-4 rounded text-app-text-4 cursor-pointer text-xs px-2 py-1 transition-colors outline-none"
                value={model ?? ''}
                onChange={(e) => handleModelChange(e.target.value || null)}
                title="Model for this session"
              >
                {modelOptions.map((opt) => (
                  <option key={opt.value ?? ''} value={opt.value ?? ''}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {chainInfoOpen && pastSegments.length > 0 && (
          <div className="px-3 pb-3 flex flex-col gap-1">
            <p className="text-[10px] text-app-border-3 uppercase tracking-wider pb-1">Session chain ({pastSegments.length + 1} segments)</p>
            {pastSegments.map((seg, i) => (
              <div key={seg.id} className="flex items-center gap-2 text-[11px] text-app-text-7">
                <span className="text-app-border-2">{i + 1}.</span>
                <span className="flex-1 truncate">{seg.title || 'Session'}</span>
                <span className="text-app-border-3 flex-shrink-0">
                  {new Date(seg.created_at * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </span>
                <span className="text-app-border-2 flex-shrink-0">{seg.messages.length} msgs</span>
              </div>
            ))}
            <div className="flex items-center gap-2 text-[11px] text-blue-500">
              <span className="text-app-border-2">{pastSegments.length + 1}.</span>
              <span className="flex-1">Current session</span>
              <span className="text-app-border-3 flex-shrink-0">{messages.length} msgs</span>
            </div>
          </div>
        )}

        {compactError && (
          <div className="px-3 pb-2 flex items-center gap-2 text-xs text-red-400">
            <span>⚠ Compact failed: {compactError}</span>
            <button onClick={() => setCompactError(null)} className="text-red-600 hover:text-red-400">✕</button>
          </div>
        )}

        {promptOpen && (
          <div className="px-3 pb-3 flex flex-col gap-2">
            <textarea
              className="bg-app-bg border border-app-border-2 focus:border-blue-600 rounded-md text-app-text text-base font-[inherit] leading-relaxed px-2.5 py-2 resize-y outline-none w-full"
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder="Instructions sent to Claude before every message in this session…"
              rows={4}
              autoFocus
            />
            <div className="flex gap-1.5 items-center">
              <button
                className="bg-blue-600 hover:bg-blue-500 border-none rounded text-white cursor-pointer text-xs px-3 py-1.5 transition-colors"
                onClick={handlePromptSave}
              >
                Save
              </button>
              <span className={`text-[11px] tabular-nums ml-1 ${promptDraft.length > 2000 ? 'text-yellow-500' : 'text-app-text-6'}`}>
                {promptDraft.length} chars
              </span>
              <button
                className="bg-transparent border border-app-border-2 hover:border-app-border-4 hover:text-app-text-3 rounded text-app-text-5 cursor-pointer text-xs px-2.5 py-1.5 transition-colors"
                onClick={() => { setPromptDraft(systemPrompt ?? ''); setPromptOpen(false) }}
              >
                Cancel
              </button>
              {systemPrompt && (
                <button
                  className="bg-transparent border border-app-border-2 hover:text-red-500 hover:border-red-500/40 rounded text-app-text-6 cursor-pointer text-xs px-2.5 py-1.5 ml-auto transition-colors"
                  onClick={async () => { await updateSystemPrompt(sessionId, null); onSystemPromptChange?.(null); setPromptDraft(''); setPromptOpen(false) }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {scheduleOpen && (
          <SchedulePanel sessionId={sessionId} timezone={timezone} refreshTick={scheduleTick + schedulesTick} />
        )}
      </div>

      {/* Scroll container — direct flex child; no extra wrapper needed */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto overscroll-y-none px-4 pt-6 md:px-6 md:pt-8 flex flex-col gap-5" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        {hasMore && (
          <div className="flex justify-center flex-shrink-0">
            <button
              onClick={loadOlder}
              disabled={loadingOlder}
              className="text-xs text-app-text-6 hover:text-app-text-4 border border-app-border-2 hover:border-app-border-4 rounded-full px-3 py-1.5 bg-transparent cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
            >
              {loadingOlder ? 'Loading…' : '↑ Load older messages'}
            </button>
          </div>
        )}

        {/* Past compacted segments with dividers */}
        {pastSegments.map((seg, segIdx) => (
          <div key={seg.id}>
            {seg.messages.map((m, i) => {
              const prev = i === 0 ? undefined : seg.messages[i - 1]
              const showDateSep = m.createdAt != null && (
                prev == null || prev.createdAt == null ||
                formatDateLabel(prev.createdAt) !== formatDateLabel(m.createdAt)
              )
              return (
                <div key={m.id} className="flex flex-col gap-5 mb-5">
                  {showDateSep && (
                    <div className="flex items-center gap-3 select-none">
                      <div className="flex-1 h-px bg-app-bg-overlay" />
                      <span className="text-[11px] text-app-text-7">{formatDateLabel(m.createdAt!)}</span>
                      <div className="flex-1 h-px bg-app-bg-overlay" />
                    </div>
                  )}
                  <MessageBubble
                    role={m.role}
                    content={m.content}
                    streaming={false}
                    errorCode={m.errorCode}
                    source={m.source}
                    toolUses={m.toolUses}
                    projectId={projectId}
                    createdAt={m.createdAt}
                    onSendToChat={(text) => { handleSend(`Output:\n\`\`\`\n${text}\n\`\`\``); setKernelRefreshTick(t => t + 1) }}
                    onSaveAsArtifact={handleSaveAsArtifact}
                  />
                </div>
              )
            })}
            <CompactDivider
              fromTitle={seg.title}
              summary={seg.compactSummary}
              compactedAt={pastSegments[segIdx + 1]?.created_at ?? Math.floor(Date.now() / 1000)}
            />
          </div>
        ))}

        {messages.length === 0 && !hasMore && pastSegments.length === 0 && (
          <div className="flex items-center justify-center flex-1 text-app-text-7 text-sm">
            {loadingSession
              ? <div className="flex items-center gap-2"><span className="w-4 h-4 rounded-full border-2 border-app-text-7 border-t-transparent animate-spin" /><span>Loading conversation…</span></div>
              : <p>Start a conversation with Claude.</p>}
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const showDateSep = m.createdAt != null && (
            prev == null ||
            prev.createdAt == null ||
            formatDateLabel(prev.createdAt) !== formatDateLabel(m.createdAt)
          )
          return (
            <div key={m.id} className="flex flex-col gap-5">
              {showDateSep && (
                <div className="flex items-center gap-3 select-none">
                  <div className="flex-1 h-px bg-app-bg-overlay" />
                  <span className="text-[11px] text-app-text-7">{formatDateLabel(m.createdAt!)}</span>
                  <div className="flex-1 h-px bg-app-bg-overlay" />
                </div>
              )}
              <MessageBubble
                role={m.role}
                content={m.content}
                streaming={m.streaming}
                errorCode={m.errorCode}
                source={m.source}
                toolUses={m.toolUses}
                onCompact={m.errorCode === 'context_limit' ? handleCompact : undefined}
                projectId={projectId}
                createdAt={m.createdAt}
                onSendToChat={(text) => { handleSend(`Output:\n\`\`\`\n${text}\n\`\`\``); setKernelRefreshTick(t => t + 1) }}
                onSaveAsArtifact={handleSaveAsArtifact}
              />
            </div>
          )
        })}
        {streaming && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 flex-wrap">
            <span className="w-1.5 h-1.5 rounded-full bg-app-text-6 tool-pulse flex-shrink-0" />
            <span className="w-1.5 h-1.5 rounded-full bg-app-text-6 tool-pulse tool-pulse-2 flex-shrink-0" />
            <span className="w-1.5 h-1.5 rounded-full bg-app-text-6 tool-pulse tool-pulse-3 flex-shrink-0" />
            {/* Assembled tool calls with detail (muted, completed) */}
            {streamingToolUses.map((call, i) => (
              <span key={i} className="text-[11px] px-1.5 py-0.5 rounded border border-app-border-2 text-app-text-6 max-w-[280px] truncate">
                <span className="text-app-text-2">{toolDisplayName(call.name, call.detail)}</span>
                {toolDisplayDetail(call.name, call.detail) && (
                  <span className="text-app-text-7">: {toolDisplayDetail(call.name, call.detail)}</span>
                )}
              </span>
            ))}
            {/* Currently streaming tool input (blue, active) */}
            {streamingTool && (
              <span className="text-[11px] px-1.5 py-0.5 rounded border border-blue-500/40 bg-blue-500/10 text-blue-400">
                {streamingTool}
              </span>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom button — lives in a zero-height div OUTSIDE the scroll container
          so it has no DOM relationship with the scrollable area. Visibility is toggled via
          direct DOM class manipulation (setIsAtBottom) to avoid React re-renders that were
          causing mobile scroll stutter by interrupting momentum deceleration. */}
      <div className="relative h-0 overflow-visible">
        <button
          ref={scrollBtnRef}
          onClick={() => {
            const container = scrollContainerRef.current
            if (!container) return
            wasAtBottomRef.current = true
            userIsScrollingRef.current = false
            skipNextScrollRef.current = true
            requestAnimationFrame(() => {
              container.scrollTop = 1e9
            })
            setIsAtBottom(true)
          }}
          className="absolute -top-12 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 bg-app-bg-card border border-app-border-3 hover:border-app-border-5 rounded-full text-app-text-4 hover:text-app-text-2 text-xs px-3 py-1.5 cursor-pointer shadow-lg transition-[opacity,visibility] duration-200 opacity-0 invisible"
          title="Scroll to bottom"
        >
          ↓ Scroll to bottom
        </button>
      </div>

      <MessageInput
        sessionId={sessionId}
        projectId={projectId}
        onSend={handleSend}
        focusTrigger={focusTrigger}
        artifacts={projectArtifacts}
        onStop={() => {
          streamingFromSendRef.current = false
          // Tell the server to kill the Claude subprocess before aborting the SSE fetch.
          stopChat(sessionId)
          cancelRef.current?.()
          setMessages((prev) =>
            prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
          )
          setStreamingTool(null)
          toolResultsRef.current = new Map()
          setStreamingToolUses([])
          setStreaming(false)
        }}
        disabled={streaming}
      />


    </div>
  )
}
