import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IKernel, KernelInfo, Language, NamedKernel, RunOptions } from './types.js'
import { PythonKernel } from './python.js'
import { BashKernel } from './bash.js'
import { NodeKernel } from './node.js'
import { CppKernel } from './cpp.js'

// Verify runner scripts exist at startup — fail loudly if the path drifts
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RUNNERS_DIR = path.resolve(__dirname, '../../../apps/notebook/src/runners')

export function verifyRunners(): void {
  const runners = ['kernel_runner.py', 'bash_runner.sh', 'node_runner.js']
  for (const r of runners) {
    const p = path.join(RUNNERS_DIR, r)
    try {
      fs.accessSync(p)
    } catch {
      console.warn(`[kernel-manager] WARNING: runner not found: ${p}`)
      console.warn(`[kernel-manager] Code execution will fail until this is resolved.`)
    }
  }
}

// 30 minutes idle timeout — kernel processes stay alive between runs for state continuity
const IDLE_TIMEOUT_MS = 30 * 60 * 1000

/**
 * Project-scoped named kernel manager.
 *
 * Kernels are identified by (projectId, name, language) — e.g. "myproject:analysis:python".
 * Any steward session in the project can attach to the same kernel by name, so state
 * survives session compaction and new session IDs.
 *
 * Kernels are cleaned up after IDLE_TIMEOUT_MS of inactivity or on explicit kill().
 */
export class ProjectKernelManager {
  // Key: `${projectId}:${name}:${language}`
  private kernels = new Map<string, NamedKernel>()

  private mapKey(projectId: string, name: string, language: Language): string {
    return `${projectId}:${name}:${language}`
  }

  private create(projectId: string, projectPath: string, name: string, language: Language): IKernel {
    switch (language) {
      case 'python': return new PythonKernel(projectPath)
      case 'bash':   return new BashKernel(projectPath)
      case 'node':   return new NodeKernel(projectPath)
      case 'cpp':    return new CppKernel(projectId, name)
    }
  }

  getOrCreate(projectId: string, projectPath: string, name: string, language: Language): NamedKernel {
    const k = this.mapKey(projectId, name, language)
    let nk = this.kernels.get(k)
    if (!nk) {
      nk = {
        name,
        language,
        projectId,
        kernel: this.create(projectId, projectPath, name, language),
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        idleTimer: null,
      }
      this.kernels.set(k, nk)
      console.log(`[kernel-manager] created kernel ${k}`)
    }
    return nk
  }

  async run(projectId: string, projectPath: string, name: string, language: Language, opts: RunOptions): Promise<void> {
    const nk = this.getOrCreate(projectId, projectPath, name, language)

    // Clear idle timer while running
    if (nk.idleTimer) {
      clearTimeout(nk.idleTimer)
      nk.idleTimer = null
    }
    nk.lastUsedAt = Date.now()

    try {
      await nk.kernel.run(opts)
    } finally {
      // Reset idle timer after run completes (success or error)
      nk.lastUsedAt = Date.now()
      this.startIdleTimer(nk)
    }
  }

  async reset(projectId: string, name: string, language: Language): Promise<void> {
    const k = this.mapKey(projectId, name, language)
    const nk = this.kernels.get(k)
    if (nk) {
      await nk.kernel.reset()
      nk.lastUsedAt = Date.now()
    }
  }

  kill(projectId: string, name: string, language: Language): void {
    const k = this.mapKey(projectId, name, language)
    const nk = this.kernels.get(k)
    if (nk) {
      if (nk.idleTimer) clearTimeout(nk.idleTimer)
      nk.kernel.kill()
      this.kernels.delete(k)
      console.log(`[kernel-manager] killed kernel ${k}`)
    }
  }

  killAllForProject(projectId: string): void {
    for (const [k, nk] of this.kernels) {
      if (nk.projectId === projectId) {
        if (nk.idleTimer) clearTimeout(nk.idleTimer)
        nk.kernel.kill()
        this.kernels.delete(k)
      }
    }
  }

  listForProject(projectId: string): KernelInfo[] {
    const result: KernelInfo[] = []
    for (const nk of this.kernels.values()) {
      if (nk.projectId === projectId) {
        result.push({
          name: nk.name,
          language: nk.language,
          projectId: nk.projectId,
          alive: nk.kernel.alive,
          pid: nk.kernel.pid,
          createdAt: nk.createdAt,
          lastUsedAt: nk.lastUsedAt,
        })
      }
    }
    return result
  }

  shutdown(): void {
    for (const nk of this.kernels.values()) {
      if (nk.idleTimer) clearTimeout(nk.idleTimer)
      nk.kernel.kill()
    }
    this.kernels.clear()
    console.log('[kernel-manager] shutdown complete')
  }

  private startIdleTimer(nk: NamedKernel): void {
    if (nk.idleTimer) clearTimeout(nk.idleTimer)
    nk.idleTimer = setTimeout(() => {
      console.log(`[kernel-manager] idle timeout for ${nk.projectId}:${nk.name}:${nk.language}`)
      nk.kernel.kill()
      this.kernels.delete(this.mapKey(nk.projectId, nk.name, nk.language))
    }, IDLE_TIMEOUT_MS)
  }
}

// Singleton
let _manager: ProjectKernelManager | null = null

export function initProjectKernelManager(): ProjectKernelManager {
  verifyRunners()
  _manager = new ProjectKernelManager()
  return _manager
}

export function getProjectKernelManager(): ProjectKernelManager {
  if (!_manager) throw new Error('ProjectKernelManager not initialised')
  return _manager
}
