export type Language = 'python' | 'node' | 'bash' | 'cpp'

export interface RunOptions {
  cellId: string
  source: string
  onLine: (line: string) => void
  onCompile?: (ok: boolean, output: string) => void  // C++ only
  signal?: AbortSignal
}

export interface IKernel {
  run(opts: RunOptions): Promise<void>
  reset(): Promise<void>
  kill(): void
  get pid(): number | null
  get alive(): boolean
}

/** What the manager stores per named kernel */
export interface NamedKernel {
  name: string
  language: Language
  projectId: string
  kernel: IKernel
  createdAt: number      // unix ms
  lastUsedAt: number     // unix ms
  idleTimer: ReturnType<typeof setTimeout> | null
}

/** Wire format for API responses */
export interface KernelInfo {
  name: string
  language: Language
  projectId: string
  alive: boolean
  pid: number | null
  createdAt: number
  lastUsedAt: number
}
