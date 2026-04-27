import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IKernel, RunOptions } from './types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RUNNER = path.join(__dirname, '..', 'runners', 'duckdb_runner.js')

export class DuckdbKernel implements IKernel {
  private child: ChildProcess | null = null
  private _pid: number | null = null
  private runQueue: Promise<void> = Promise.resolve()
  private pendingResolvers = new Map<string, {
    resolve: () => void
    reject: (e: Error) => void
    onLine: (l: string) => void
  }>()

  constructor(private readonly dataDir: string) {}

  private spawn(): void {
    this.child = spawn(process.execPath, [RUNNER], {
      cwd: this.dataDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this._pid = this.child.pid ?? null

    const rl = createInterface({ input: this.child.stdout!, crlfDelay: Infinity })

    this.child.stderr!.on('data', (data: Buffer) => {
      const text = data.toString()
      for (const [, { onLine }] of this.pendingResolvers) {
        onLine(text.trimEnd())
      }
    })

    rl.on('line', (line) => {
      if (line.startsWith('DONE ') || line.startsWith('ERR ')) {
        const [sentinel, cellId] = line.split(' ')
        const pending = this.pendingResolvers.get(cellId)
        if (pending) {
          this.pendingResolvers.delete(cellId)
          if (sentinel === 'DONE') pending.resolve()
          else pending.reject(new Error(`Cell ${cellId} errored`))
        }
      } else if (line === 'RESET_DONE') {
        // handled in reset()
      } else {
        for (const [, { onLine }] of this.pendingResolvers) {
          onLine(line)
        }
      }
    })

    this.child.on('exit', () => {
      this._pid = null
      this.child = null
      for (const [cellId, { reject }] of this.pendingResolvers) {
        reject(new Error(`DuckDB kernel exited while running cell ${cellId}`))
      }
      this.pendingResolvers.clear()
    })

    console.log(`[duckdb-kernel] spawned pid=${this._pid}`)
  }

  private ensureAlive(): void {
    if (!this.child || !this._pid) this.spawn()
  }

  run(opts: RunOptions): Promise<void> {
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

      signal?.addEventListener('abort', () => {
        if (!done) {
          // DuckDB queries can't be interrupted mid-flight; mark as done and kill
          this.pendingResolvers.delete(cellId)
          guardedReject(new Error('aborted'))
        }
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
      const onData = (data: Buffer) => {
        if (data.toString().includes('RESET_DONE')) {
          this.child?.stdout?.off('data', onData)
          resolve()
        }
      }
      this.child!.stdout!.on('data', onData)
      this.child!.stdin!.write('RESET\n')
      setTimeout(resolve, 2000)
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
