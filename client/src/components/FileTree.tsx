import { useState, useEffect, useCallback } from 'react'
import { listFiles, getFileContent, type FileEntry } from '../lib/api'

type Props = {
  projectId: string
  /** When true the tree is always shown without a toggle button and fills available height. */
  alwaysExpanded?: boolean
}

type ViewerState = { path: string; content: string } | null

export function FileTree({ projectId, alwaysExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(alwaysExpanded)
  const [tree, setTree] = useState<Map<string, FileEntry[]>>(new Map())
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [viewer, setViewer] = useState<ViewerState>(null)

  const loadDir = useCallback(async (dirPath: string) => {
    if (tree.has(dirPath)) return
    setLoading(true)
    try {
      const entries = await listFiles(projectId, dirPath)
      setTree((prev) => new Map(prev).set(dirPath, entries))
    } catch (err) {
      console.error('[FileTree] load error', err)
    } finally {
      setLoading(false)
    }
  }, [projectId, tree])

  useEffect(() => {
    if (expanded && !tree.has('')) {
      void loadDir('')
    }
  }, [expanded, loadDir, tree])

  async function toggleDir(path: string) {
    if (openDirs.has(path)) {
      setOpenDirs((prev) => { const s = new Set(prev); s.delete(path); return s })
    } else {
      setOpenDirs((prev) => new Set(prev).add(path))
      await loadDir(path)
    }
  }

  async function openFile(path: string) {
    try {
      const content = await getFileContent(projectId, path)
      setViewer({ path, content })
    } catch (err) {
      alert((err as Error).message)
    }
  }

  function renderEntries(entries: FileEntry[], depth: number) {
    return entries.map((entry) => (
      <div key={entry.path} style={{ paddingLeft: depth * 12 }}>
        {entry.type === 'directory' ? (
          <>
            <button
              className="flex items-center gap-1 w-full bg-transparent border-none text-[#7aa2d4] hover:text-[#93bbf0] font-medium text-xs px-1.5 py-1.5 cursor-pointer text-left rounded hover:bg-[#1a1a1a] transition-colors min-h-[36px]"
              onClick={() => void toggleDir(entry.path)}
            >
              <span>{openDirs.has(entry.path) ? '▾' : '▸'}</span>
              <span>{entry.name}/</span>
            </button>
            {openDirs.has(entry.path) && tree.has(entry.path) &&
              renderEntries(tree.get(entry.path)!, depth + 1)
            }
          </>
        ) : (
          <button
            className="flex items-center gap-1 w-full bg-transparent border-none text-[#888] hover:text-[#ccc] text-xs px-1.5 py-1.5 cursor-pointer text-left rounded hover:bg-[#1a1a1a] transition-colors font-[inherit] min-h-[36px]"
            onClick={() => void openFile(entry.path)}
          >
            <span className="text-[#444] flex-shrink-0">·</span>
            <span className="truncate">{entry.name}</span>
          </button>
        )}
      </div>
    ))
  }

  return (
    <>
      {alwaysExpanded ? (
        /* Full-height mode used when embedded in the Files tab */
        <div className="flex-1 overflow-y-auto px-1.5 py-1.5 min-h-0">
          {loading && !tree.has('') && (
            <p className="text-xs text-[#444] px-2.5 py-1.5">Loading…</p>
          )}
          {tree.has('') && tree.get('')!.length === 0 && (
            <p className="text-xs text-[#444] px-2.5 py-1.5 italic">Empty directory</p>
          )}
          {tree.has('') && renderEntries(tree.get('')!, 0)}
        </div>
      ) : (
        /* Collapsed-by-default mode used at the bottom of the Sessions tab */
        <div className="border-t border-[#1f1f1f] flex-shrink-0">
          <button
            className="w-full flex items-center gap-1.5 px-3 py-2 bg-transparent border-none text-[#555] hover:text-[#888] text-[11px] font-semibold tracking-widest uppercase cursor-pointer text-left transition-colors"
            onClick={() => setExpanded((e) => !e)}
          >
            <span>{expanded ? '▾' : '▸'}</span>
            <span>Files</span>
            {loading && <span className="text-[#444] text-[11px]">…</span>}
          </button>
          {expanded && (
            <div className="max-h-[200px] overflow-y-auto px-1.5 pb-1.5">
              {tree.has('') && tree.get('')!.length === 0 && (
                <p className="text-xs text-[#444] px-2.5 py-1.5 italic">Empty directory</p>
              )}
              {tree.has('') && renderEntries(tree.get('')!, 0)}
            </div>
          )}
        </div>
      )}

      {viewer && (
        <div
          className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 md:p-8"
          onClick={() => setViewer(null)}
        >
          <div
            className="bg-[#131313] border border-[#2a2a2a] rounded-xl w-full max-w-[860px] max-h-[80dvh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f1f1f] gap-3">
              <span className="text-[13px] text-[#888] font-mono overflow-hidden text-ellipsis whitespace-nowrap">
                {viewer.path}
              </span>
              <button
                className="bg-transparent border-none text-[#666] hover:text-[#ccc] hover:bg-[#222] text-xl cursor-pointer flex-shrink-0 leading-none px-2 py-1 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                onClick={() => setViewer(null)}
              >
                ×
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-[13px] leading-relaxed font-['SF_Mono','Fira_Code',monospace] text-[#ccc] whitespace-pre bg-transparent border-none m-0">
              <code>{viewer.content}</code>
            </pre>
          </div>
        </div>
      )}
    </>
  )
}
