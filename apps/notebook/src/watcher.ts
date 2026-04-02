import chokidar from 'chokidar'
import fs from 'node:fs'
import path from 'node:path'

type CellUpdateCallback = (cellId: string, source: string) => void

// Track recent server-side writes to suppress watcher echo
const pendingWrites = new Map<string, number>()

export function markServerWrite(cellId: string): void {
  pendingWrites.set(cellId, Date.now())
}

const WRITE_SUPPRESS_MS = 500

// Debounce timers per cell
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function startWatcher(cellsDir: string, onCellChanged: CellUpdateCallback): void {
  chokidar.watch(cellsDir, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  }).on('change', (filePath: string) => {
    const filename = path.basename(filePath)
    const match = filename.match(/^([a-f0-9-]{36})\.(py|js|sh|cpp|md)$/)
    if (!match) return

    const cellId = match[1]

    // Suppress if this was a server-side write
    const lastWrite = pendingWrites.get(cellId)
    if (lastWrite && Date.now() - lastWrite < WRITE_SUPPRESS_MS) return

    // Debounce per cell
    const existing = debounceTimers.get(cellId)
    if (existing) clearTimeout(existing)

    debounceTimers.set(cellId, setTimeout(() => {
      debounceTimers.delete(cellId)
      try {
        const source = fs.readFileSync(filePath, 'utf8')
        onCellChanged(cellId, source)
      } catch {
        // File may have been deleted — ignore
      }
    }, 150))
  })

  console.log(`[notebook] watching ${cellsDir}`)
}
