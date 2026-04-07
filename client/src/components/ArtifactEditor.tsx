import { useCallback, useEffect, useRef, useState } from 'react'
import type { Artifact } from '../lib/api'
import { ArtifactViewer } from './ArtifactViewer'

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

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640

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

  const typeBadgeColor: Record<string, string> = {
    chart: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
    report: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
    data: 'text-green-400 bg-green-400/10 border-green-400/20',
    code: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  }
  const badgeClass = typeBadgeColor[artifact.type] ?? 'text-[#888] bg-[#222] border-[#333]'

  const viewerArtifact = { ...artifact }

  const editorEl = (
    <textarea
      className="w-full h-full resize-none bg-[#0d0d0d] text-[#ccc] font-mono text-[12px] leading-[1.6] p-3 focus:outline-none border-none"
      value={localContent}
      onChange={(e) => handleChange(e.target.value)}
      spellCheck={false}
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
