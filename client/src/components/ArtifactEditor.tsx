import { useCallback, useEffect, useRef, useState } from 'react'
import type { Artifact } from '../lib/api'
import { updateArtifact } from '../lib/api'
import { ArtifactViewer } from './ArtifactViewer'
import { ArtifactCodeMirror } from './ArtifactCodeMirror'

interface Props {
  artifact: Artifact
  content: string
  onChange: (newContent: string) => void
  onSave: () => void
}

type SaveStatus = 'idle' | 'saving' | 'saved'

export function ArtifactEditor({ artifact, content, onChange, onSave }: Props) {
  // Local editing value — starts from content prop but is independent after that
  const [localContent, setLocalContent] = useState(content)
  // For chart: debounced viewer content
  const [viewerContent, setViewerContent] = useState(content)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [mobileTab, setMobileTab] = useState<'editor' | 'preview'>('editor')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [refreshCmd, setRefreshCmd] = useState('')
  const [refreshSched, setRefreshSched] = useState('')
  const [metaSaving, setMetaSaving] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  // Sync local state if the content prop changes externally (e.g. SSE refresh)
  useEffect(() => {
    setLocalContent(content)
    setViewerContent(content)
  }, [content])

  const handleChange = useCallback((val: string) => {
    setLocalContent(val)
    onChange(val)

    if (artifact.type === 'chart') {
      // Debounce chart preview — expensive Vega re-render
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        setViewerContent(val)
      }, 400)
    } else {
      setViewerContent(val)
    }
  }, [artifact.type, onChange])

  const handleSave = useCallback(async () => {
    if (saveStatus === 'saving') return
    setSaveStatus('saving')
    try {
      onSave()
      setSaveStatus('saved')
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('idle')
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

  const typeBadgeColor: Record<string, string> = {
    chart: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
    report: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
    data: 'text-green-400 bg-green-400/10 border-green-400/20',
    code: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  }
  const badgeClass = typeBadgeColor[artifact.type] ?? 'text-[#888] bg-[#222] border-[#333]'

  const viewerArtifact = { ...artifact }

  const editorLanguage = (() => {
    if (artifact.type === 'report') return 'markdown'
    if (artifact.type === 'chart') return 'json'
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

  const editorEl = (
    <ArtifactCodeMirror
      value={localContent}
      onChange={handleChange}
      language={editorLanguage}
      className="w-full h-full"
    />
  )

  const previewEl = (
    <div className="w-full h-full overflow-auto p-3">
      <ArtifactViewer artifact={viewerArtifact} content={viewerContent} />
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header strip */}
      <div className="flex items-center gap-2 h-10 px-3 border-b border-[#1f1f1f] flex-shrink-0 bg-[#111]">
        <span className="flex-1 text-[13px] text-[#ccc] truncate font-medium">{artifact.name}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badgeClass} flex-shrink-0`}>
          {artifact.type}
        </span>
        {/* Mobile tab toggle */}
        {isMobile && (
          <button
            onClick={() => setMobileTab(t => t === 'editor' ? 'preview' : 'editor')}
            className="text-[11px] text-[#666] hover:text-[#aaa] border border-[#2a2a2a] rounded px-2 py-0.5 cursor-pointer flex-shrink-0"
          >
            {mobileTab === 'editor' ? 'Preview' : 'Edit'}
          </button>
        )}
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
              : 'text-[#888] border-[#2a2a2a] bg-[#1a1a1a] hover:text-[#ccc] hover:border-[#444]'
            }`}
        >
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : 'Save'}
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
      {isMobile ? (
        <div className="flex-1 overflow-hidden">
          {mobileTab === 'editor' ? editorEl : previewEl}
        </div>
      ) : (
        <div className="flex flex-row flex-1 overflow-hidden">
          <div className="w-1/2 h-full border-r border-[#1f1f1f] overflow-hidden flex">
            {editorEl}
          </div>
          <div className="w-1/2 h-full overflow-auto">
            {previewEl}
          </div>
        </div>
      )}
    </div>
  )
}
