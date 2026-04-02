export type Language = 'python' | 'node' | 'bash' | 'cpp'

export interface RunOptions {
  cellId: string
  source: string
  onLine: (line: string) => void
  onCompile?: (ok: boolean, output: string) => void  // C++ only
  signal?: AbortSignal
}

export interface KernelStatus {
  language: Language
  alive: boolean
  pid: number | null
}

export interface IKernel {
  run(opts: RunOptions): Promise<void>
  reset(): Promise<void>
  kill(): void
  get pid(): number | null
  get alive(): boolean
}
