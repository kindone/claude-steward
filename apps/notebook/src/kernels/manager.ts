import type { IKernel, KernelStatus, Language, RunOptions } from './types.js'
import { PythonKernel } from './python.js'
import { NodeKernel } from './node.js'
import { BashKernel } from './bash.js'
import { CppKernel } from './cpp.js'

export class KernelManager {
  private kernels = new Map<Language, IKernel>()

  constructor(private readonly dataDir: string) {}

  private get(lang: Language): IKernel {
    let kernel = this.kernels.get(lang)
    if (!kernel) {
      kernel = this.create(lang)
      this.kernels.set(lang, kernel)
    }
    return kernel
  }

  private create(lang: Language): IKernel {
    switch (lang) {
      case 'python': return new PythonKernel(this.dataDir)
      case 'node':   return new NodeKernel(this.dataDir)
      case 'bash':   return new BashKernel(this.dataDir)
      case 'cpp':    return new CppKernel(this.dataDir)
    }
  }

  run(lang: Language, opts: RunOptions): Promise<void> {
    return this.get(lang).run(opts)
  }

  async restart(lang: Language): Promise<void> {
    const kernel = this.kernels.get(lang)
    if (kernel) {
      kernel.kill()
      this.kernels.delete(lang)
    }
    // Re-create lazily on next run
    console.log(`[kernel-manager] restarted ${lang} kernel`)
  }

  async resetState(lang: Language): Promise<void> {
    const kernel = this.kernels.get(lang)
    if (kernel) await kernel.reset()
  }

  status(): KernelStatus[] {
    const langs: Language[] = ['python', 'node', 'bash', 'cpp']
    return langs.map(lang => {
      const kernel = this.kernels.get(lang)
      return {
        language: lang,
        alive: kernel?.alive ?? false,
        pid: kernel?.pid ?? null,
      }
    })
  }

  shutdown(): void {
    for (const [lang, kernel] of this.kernels) {
      console.log(`[kernel-manager] killing ${lang} kernel`)
      kernel.kill()
    }
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
