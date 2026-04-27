import type { IKernel, KernelStatus, Language, RunOptions } from './types.js'
import { PythonKernel } from './python.js'
import { NodeKernel } from './node.js'
import { BashKernel } from './bash.js'
import { CppKernel } from './cpp.js'
import { DuckdbKernel } from './duckdb.js'

const LANGUAGES: Language[] = ['python', 'node', 'bash', 'cpp', 'sql']

export class KernelManager {
  // Key: `${notebookId}:${language}` for per-notebook isolation
  private kernels = new Map<string, IKernel>()

  constructor(private readonly dataDir: string) {}

  private key(notebookId: string, lang: Language): string {
    return `${notebookId}:${lang}`
  }

  private getOrCreate(notebookId: string, lang: Language): IKernel {
    const k = this.key(notebookId, lang)
    let kernel = this.kernels.get(k)
    if (!kernel) {
      kernel = this.create(lang)
      this.kernels.set(k, kernel)
    }
    return kernel
  }

  private create(lang: Language): IKernel {
    switch (lang) {
      case 'python': return new PythonKernel(this.dataDir)
      case 'node':   return new NodeKernel(this.dataDir)
      case 'bash':   return new BashKernel(this.dataDir)
      case 'cpp':    return new CppKernel(this.dataDir)
      case 'sql':    return new DuckdbKernel(this.dataDir)
    }
  }

  run(notebookId: string, lang: Language, opts: RunOptions): Promise<void> {
    return this.getOrCreate(notebookId, lang).run(opts)
  }

  async restart(notebookId: string, lang: Language): Promise<void> {
    const k = this.key(notebookId, lang)
    const kernel = this.kernels.get(k)
    if (kernel) {
      kernel.kill()
      this.kernels.delete(k)
    }
    console.log(`[kernel-manager] restarted ${lang} kernel for notebook ${notebookId}`)
  }

  async resetState(notebookId: string, lang: Language): Promise<void> {
    const kernel = this.kernels.get(this.key(notebookId, lang))
    if (kernel) await kernel.reset()
  }

  status(notebookId: string): KernelStatus[] {
    return LANGUAGES.map(lang => {
      const kernel = this.kernels.get(this.key(notebookId, lang))
      return { language: lang, alive: kernel?.alive ?? false, pid: kernel?.pid ?? null }
    })
  }

  /** Kill all kernels belonging to a notebook (called on tab close). */
  killNotebook(notebookId: string): void {
    for (const lang of LANGUAGES) {
      const k = this.key(notebookId, lang)
      const kernel = this.kernels.get(k)
      if (kernel) {
        kernel.kill()
        this.kernels.delete(k)
      }
    }
    console.log(`[kernel-manager] killed kernels for notebook ${notebookId}`)
  }

  shutdown(): void {
    for (const [, kernel] of this.kernels) kernel.kill()
    this.kernels.clear()
  }
}

// Singleton — initialised by server.ts
let _manager: KernelManager | null = null

export function initKernelManager(dataDir: string): KernelManager {
  _manager = new KernelManager(dataDir)
  return _manager
}

export function getKernelManager(): KernelManager {
  if (!_manager) throw new Error('KernelManager not initialised')
  return _manager
}
