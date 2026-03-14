import { useState, useEffect, useCallback } from 'react'
import { listFiles, getFileContent, type FileEntry } from '../lib/api'

type Props = {
  projectId: string
}

type ViewerState = { path: string; content: string } | null

export function FileTree({ projectId }: Props) {
  const [expanded, setExpanded] = useState(false)
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
              className="file-tree__entry file-tree__entry--dir"
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
            className="file-tree__entry file-tree__entry--file"
            onClick={() => void openFile(entry.path)}
          >
            <span className="file-tree__file-icon">·</span>
            <span>{entry.name}</span>
          </button>
        )}
      </div>
    ))
  }

  return (
    <>
      <div className="file-tree">
        <button
          className="file-tree__toggle"
          onClick={() => setExpanded((e) => !e)}
        >
          <span>{expanded ? '▾' : '▸'}</span>
          <span>Files</span>
          {loading && <span className="file-tree__spinner">…</span>}
        </button>

        {expanded && (
          <div className="file-tree__body">
            {tree.has('') && tree.get('')!.length === 0 && (
              <p className="file-tree__empty">Empty directory</p>
            )}
            {tree.has('') && renderEntries(tree.get('')!, 0)}
          </div>
        )}
      </div>

      {viewer && (
        <div className="file-viewer-overlay" onClick={() => setViewer(null)}>
          <div className="file-viewer" onClick={(e) => e.stopPropagation()}>
            <div className="file-viewer__header">
              <span className="file-viewer__path">{viewer.path}</span>
              <button className="file-viewer__close" onClick={() => setViewer(null)}>×</button>
            </div>
            <pre className="file-viewer__content"><code>{viewer.content}</code></pre>
          </div>
        </div>
      )}
    </>
  )
}
