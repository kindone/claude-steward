import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { Artifact } from '../lib/api'
import { updateArtifact } from '../lib/api'
import { ArtifactViewer } from './ArtifactViewer'
import { ArtifactCodeMirror } from './ArtifactCodeMirror'
import { KernelOutputPanel, type OutputPanelState } from './KernelOutputPanel'
import { runCode, normalizeLanguage } from '../lib/kernelApi'

type ViewMode = 'split' | 'source' | 'preview'

interface Props {
  artifact: Artifact
  content: string
  projectId: string | null
  onChange: (newContent: string) => void
  onSave: () => Promise<void>
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// Memoized wrapper — bails out when viewerContent and artifact haven't changed,
// so ArtifactViewer never re-renders during keystrokes (only after debounce fires).
const PreviewPane = memo(function PreviewPane({ artifact, content }: { artifact: Artifact; content: string }) {
  return (
    <div className="w-full h-full overflow-auto p-3">
      <ArtifactViewer artifact={artifact} content={content} />
    </div>
  )
})

export function ArtifactEditor({ artifact, content, projectId, onChange, onSave }: Props) {
  // Local editing value — starts from content prop but is independent after that
  const [localContent, setLocalContent] = useState(content)
  // For chart: debounced viewer content
  const [viewerContent, setViewerContent] = useState(content)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [mobileTab, setMobileTab] = useState<'editor' | 'preview'>('editor')
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [refreshCmd, setRefreshCmd] = useState('')
  const [refreshSched, setRefreshSched] = useState('')
  const [metaSaving, setMetaSaving] = useState(false)
  // Line-wrap toggle — default ON for report, OFF for everything else; persisted per type
  const [wrapLines, setWrapLines] = useState<boolean>(() => {
    const stored = localStorage.getItem(`artifact-wrap:${artifact.type}`)
    if (stored !== null) return stored === '1'
    return artifact.type === 'report'
  })

  function toggleWrap() {
    setWrapLines(prev => {
      const next = !prev
      localStorage.setItem(`artifact-wrap:${artifact.type}`, next ? '1' : '0')
      return next
    })
  }

  // Kernel run state for code artifacts
  const [runState, setRunState] = useState<OutputPanelState | null>(null)
  const runAbortRef = useRef<(() => void) | undefined>(undefined)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // True while the user is actively editing — prevents the content-prop useEffect
  // from immediately updating viewerContent and bypassing the debounce.
  const userEditingRef = useRef(false)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640

  // Sync settings from metadata when artifact changes
  useEffect(() => {
    if (!artifact.metadata) {
      setRefreshCmd('')
      setRefreshSched('')
      return
    }
    try {
      const m = JSON.parse(artifact.metadata) as Record<string, unknown>
      setRefreshCmd((m.refresh_command as string) ?? '')
      setRefreshSched((m.refresh_schedule as string) ?? '')
    } catch { /* ignore */ }
  }, [artifact.metadata])

  // Sync local state if the content prop changes externally (e.g. SSE refresh).
  // Skip viewerContent sync when the user is actively typing — the debounce
  // in handleChange owns that update path.
  useEffect(() => {
    setLocalContent(content)
    if (!userEditingRef.current) {
      setViewerContent(content)
    }
  }, [content])

  const handleChange = useCallback((val: string) => {
    setLocalContent(val)
    onChange(val)

    // 1000ms: report/html (markdown parse + MdArt hydration)
    //  600ms: chart/mdart/pikchr (SVG / Vega compile)
    const previewDelay =
      artifact.type === 'report' || artifact.type === 'html' ? 1000
      : artifact.type === 'chart' || artifact.type === 'mdart' || artifact.type === 'pikchr' ? 600
      : 0

    if (previewDelay > 0) {
      // Mark as user-editing so the content-prop useEffect doesn't bypass the debounce
      userEditingRef.current = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        userEditingRef.current = false
        setViewerContent(val)
      }, previewDelay)
    } else {
      setViewerContent(val)
    }
  }, [artifact.type, onChange])

  const handleSave = useCallback(async () => {
    if (saveStatus === 'saving') return
    setSaveStatus('saving')
    try {
      await onSave()
      setSaveStatus('saved')
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      console.error('[artifact] save failed:', err)
      setSaveStatus('error')
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }, [saveStatus, onSave])

  async function handleSaveMeta() {
    setMetaSaving(true)
    try {
      let existingMeta: Record<string, unknown> = {}
      if (artifact.metadata) { try { existingMeta = JSON.parse(artifact.metadata) as Record<string, unknown> } catch { /* ignore */ } }
      const newMeta = { ...existingMeta, refresh_command: refreshCmd || undefined, refresh_schedule: refreshSched || undefined }
      await updateArtifact(artifact.id, { metadata: JSON.stringify(newMeta) })
    } finally {
      setMetaSaving(false)
      setSettingsOpen(false)
    }
  }

  const editorLanguage = (() => {
    if (artifact.type === 'report') return 'markdown'
    if (artifact.type === 'chart') return 'json'
    if (artifact.type === 'html') return 'html'
    if (artifact.type === 'data') {
      const t = localContent.trim()
      return (t.startsWith('{') || t.startsWith('[')) ? 'json' : ''
    }
    if (artifact.type === 'code') {
      try {
        const m = JSON.parse(artifact.metadata ?? '{}') as { language?: string }
        return m.language ?? ''
      } catch { return '' }
    }
    return ''
  })()

  const kernelLang = normalizeLanguage(editorLanguage)
  const canRun = artifact.type === 'code' && kernelLang !== null && projectId !== null

  function handleRun() {
    if (!canRun || !projectId || !kernelLang) return

    // Abort any existing run
    runAbortRef.current?.()

    setRunState({ status: 'running', lines: [], exitCode: null, durationMs: null })

    const abort = runCode(projectId, 'default', kernelLang, localContent, (event) => {
      if (event.type === 'output') {
        setRunState(prev => prev ? { ...prev, lines: [...prev.lines, event.text] } : prev)
      } else if (event.type === 'done') {
        setRunState(prev => prev ? {
          ...prev,
          status: event.exitCode === 0 ? 'done' : 'error',
          exitCode: event.exitCode,
          durationMs: event.durationMs,
          abort: undefined,
        } : prev)
      }
    })

    runAbortRef.current = abort
    setRunState(prev => prev ? { ...prev, abort: () => abort() } : prev)
  }

  const typeBadgeColor: Record<string, string> = {
    chart: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
    report: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
    data: 'text-green-400 bg-green-400/10 border-green-400/20',
    code: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  }
  const badgeClass = typeBadgeColor[artifact.type] ?? 'text-[#888] bg-[#222] border-[#333]'

  const editorEl = (
    <ArtifactCodeMirror
      value={localContent}
      onChange={handleChange}
      language={editorLanguage}
      wrapLines={wrapLines}
      className="w-full h-full"
    />
  )

  const previewEl = <PreviewPane artifact={artifact} content={viewerContent} />

  return (
    <div className="flex flex-col h-full">
      {/* Header strip */}
      <div className="flex items-center gap-2 h-10 px-3 border-b border-[#1f1f1f] flex-shrink-0 bg-[#111]">
        <span className="flex-1 text-[13px] text-[#ccc] truncate font-medium">{artifact.name}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badgeClass} flex-shrink-0`}>
          {artifact.type}
        </span>
        {/* Mobile tab toggle — only for types with a preview pane */}
        {isMobile && artifact.type !== 'code' && (
          <button
            onClick={() => setMobileTab(t => t === 'editor' ? 'preview' : 'editor')}
            className="text-[11px] text-[#666] hover:text-[#aaa] border border-[#2a2a2a] rounded px-2 py-0.5 cursor-pointer flex-shrink-0"
          >
            {mobileTab === 'editor' ? 'Preview' : 'Edit'}
          </button>
        )}
        {/* Desktop view mode toggle — types with a preview pane */}
        {!isMobile && artifact.type !== 'code' && (
          <div className="flex items-center rounded border border-[#2a2a2a] overflow-hidden text-[11px] flex-shrink-0">
            {(['split', 'source', 'preview'] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                title={{ split: 'Side by side', source: 'Source only', preview: 'Preview only' }[m]}
                className={`px-2 py-0.5 transition-colors ${
                  viewMode === m
                    ? 'bg-[#2a2a2a] text-[#ccc]'
                    : 'text-[#555] hover:text-[#888] hover:bg-[#1a1a1a]'
                }`}
              >
                {{ split: '⬛⬛', source: '≡', preview: '◻' }[m]}
              </button>
            ))}
          </div>
        )}
        {/* Run button — code artifacts only */}
        {canRun && (
          <button
            onClick={handleRun}
            disabled={runState?.status === 'running'}
            className="text-[11px] px-2.5 py-1 rounded border cursor-pointer transition-colors flex-shrink-0 disabled:opacity-50 text-emerald-400 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20"
            title="Run code"
          >
            {runState?.status === 'running' ? '⏳ Running…' : '▶ Run'}
          </button>
        )}
        <button
          onClick={toggleWrap}
          className={`text-[11px] px-2 py-1 rounded border cursor-pointer transition-colors flex-shrink-0
            ${wrapLines ? 'text-[#ccc] border-[#444] bg-[#222]' : 'text-[#555] border-[#2a2a2a] bg-[#1a1a1a] hover:text-[#aaa]'}`}
          title={wrapLines ? 'Line wrap on — click to disable' : 'Line wrap off — click to enable'}
        >
          ↵
        </button>
        <button
          onClick={() => setSettingsOpen(o => !o)}
          className={`text-[11px] px-2 py-1 rounded border cursor-pointer transition-colors flex-shrink-0
            ${settingsOpen ? 'text-[#ccc] border-[#444] bg-[#222]' : 'text-[#555] border-[#2a2a2a] bg-[#1a1a1a] hover:text-[#aaa]'}`}
          title="Artifact settings"
        >
          ⚙
        </button>
        <button
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
          className={`text-[11px] px-2.5 py-1 rounded border cursor-pointer transition-colors flex-shrink-0 disabled:opacity-50
            ${saveStatus === 'saved'
              ? 'text-green-400 border-green-400/30 bg-green-400/10'
              : saveStatus === 'error'
              ? 'text-red-400 border-red-400/30 bg-red-400/10'
              : 'text-[#888] border-[#2a2a2a] bg-[#1a1a1a] hover:text-[#ccc] hover:border-[#444]'
            }`}
        >
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Error ✗' : 'Save'}
        </button>
      </div>

      {/* Settings panel */}
      {settingsOpen && (
        <div className="flex-shrink-0 border-b border-[#1f1f1f] p-3 bg-[#0d0d0d] flex flex-col gap-2">
          <label className="text-[11px] text-[#666]">Refresh command</label>
          <input value={refreshCmd} onChange={e => setRefreshCmd(e.target.value)}
            placeholder="e.g. python fetch_data.py"
            className="text-[12px] bg-[#111] border border-[#2a2a2a] rounded px-2 py-1 text-[#ccc] outline-none font-mono" />
          <label className="text-[11px] text-[#666]">Refresh schedule (cron)</label>
          <input value={refreshSched} onChange={e => setRefreshSched(e.target.value)}
            placeholder="e.g. 0 17 * * 1-5"
            className="text-[12px] bg-[#111] border border-[#2a2a2a] rounded px-2 py-1 text-[#ccc] outline-none font-mono" />
          <button onClick={() => void handleSaveMeta()} disabled={metaSaving}
            className="self-start text-[11px] px-2.5 py-1 rounded border border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:text-[#ccc] cursor-pointer disabled:opacity-50">
            {metaSaving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}

      {/* Content area */}
      {artifact.type === 'code' ? (
        // Code artifacts: full-width editor + optional output panel below
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden flex">
            {editorEl}
          </div>
          {runState && (
            <div className="flex-shrink-0 border-t border-[#1f1f1f] max-h-[40%] overflow-auto">
              <KernelOutputPanel
                state={runState}
                onDismiss={() => setRunState(null)}
              />
            </div>
          )}
        </div>
      ) : isMobile ? (
        // Mobile: single-pane tab toggle
        <div className="flex-1 overflow-hidden">
          {mobileTab === 'editor' ? editorEl : previewEl}
        </div>
      ) : (
        // Desktop: view mode — split / source-only / preview-only
        <div className="flex flex-row flex-1 overflow-hidden">
          {(viewMode === 'split' || viewMode === 'source') && (
            <div className={`h-full overflow-hidden flex ${viewMode === 'split' ? 'w-1/2 border-r border-[#1f1f1f]' : 'w-full'}`}>
              {editorEl}
            </div>
          )}
          {(viewMode === 'split' || viewMode === 'preview') && (
            <div className={`h-full overflow-auto ${viewMode === 'split' ? 'w-1/2' : 'w-full'}`}>
              {previewEl}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
