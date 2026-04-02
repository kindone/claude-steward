import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IKernel, RunOptions } from './types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RUNNER = path.join(__dirname, '..', 'runners', 'kernel_runner.py')

export class PythonKernel implements IKernel {
  private child: ChildProcess | null = null
  private _pid: number | null = null
  private runQueue: Promise<void> = Promise.resolve()
  private pendingResolvers = new Map<string, { resolve: () => void; reject: (e: Error) => void; onLine: (l: string) => void }>()

  constructor(private readonly dataDir: string) {}

  private spawn(): void {
    this.child = spawn('python3', [RUNNER], {
      cwd: this.dataDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })
    this._pid = this.child.pid ?? null

    // Merge stderr into stdout stream by piping stderr to stdout handler
    const rl = createInterface({ input: this.child.stdout!, crlfDelay: Infinity })

    this.child.stderr!.on('data', (data: Buffer) => {
      const text = data.toString()
      // Route to the currently running cell's onLine, if any
      for (const [, { onLine }] of this.pendingResolvers) {
        onLine(text.trimEnd())
      }
    })

    rl.on('line', (line) => {
      // Check for sentinel
      if (line.startsWith('DONE ') || line.startsWith('ERR ')) {
        const [sentinel, cellId] = line.split(' ')
        const pending = this.pendingResolvers.get(cellId)
        if (pending) {
          this.pendingResolvers.delete(cellId)
          if (sentinel === 'DONE') {
            pending.resolve()
          } else {
            pending.reject(new Error(`Cell ${cellId} errored`))
          }
        }
      } else if (line === 'RESET_DONE') {
        // handled separately
      } else {
        // Route output to the running cell
        for (const [, { onLine }] of this.pendingResolvers) {
          onLine(line)
        }
      }
    })

    this.child.on('exit', () => {
      this._pid = null
      this.child = null
      // Reject any pending runs
      for (const [cellId, { reject }] of this.pendingResolvers) {
        reject(new Error(`Python kernel exited while running cell ${cellId}`))
      }
      this.pendingResolvers.clear()
    })

    console.log(`[python-kernel] spawned pid=${this._pid}`)
  }

  private ensureAlive(): void {
    if (!this.child || !this._pid) this.spawn()
  }

  run(opts: RunOptions): Promise<void> {
    // Serialise runs via a queue
    this.runQueue = this.runQueue.then(() => this._run(opts)).catch(() => this._run(opts))
    return this.runQueue
  }

  private _run({ cellId, source, onLine, signal }: RunOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('aborted')); return }

      this.ensureAlive()

      const b64 = Buffer.from(source).toString('base64')

      let done = false
      const guardedResolve = () => { done = true; resolve() }
      const guardedReject = (e: Error) => { done = true; reject(e) }

      this.pendingResolvers.set(cellId, { resolve: guardedResolve, reject: guardedReject, onLine })

      // Only interrupt if the cell is still running when abort fires
      signal?.addEventListener('abort', () => {
        if (!done) this.child?.stdin?.write(`INTERRUPT ${cellId}\n`)
      }, { once: true })

      this.child!.stdin!.write(`RUN ${cellId} ${b64}\n`, (err) => {
        if (err) {
          this.pendingResolvers.delete(cellId)
          guardedReject(err)
        }
      })
    })
  }

  async reset(): Promise<void> {
    if (!this.child) return
    return new Promise((resolve) => {
      const rl = createInterface({ input: this.child!.stdout! })
      const onLine = (line: string) => {
        if (line.trim() === 'RESET_DONE') {
          rl.close()
          resolve()
        }
      }
      rl.on('line', onLine)
      this.child!.stdin!.write('RESET\n')
      setTimeout(resolve, 2000) // timeout fallback
    })
  }

  kill(): void {
    if (this.child) {
      this.child.kill('SIGTERM')
      this.child = null
      this._pid = null
    }
  }

  get pid(): number | null { return this._pid }
  get alive(): boolean { return this.child !== null }
}
