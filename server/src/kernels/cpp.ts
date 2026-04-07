import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IKernel, RunOptions } from './types.js'

export class CppKernel implements IKernel {
  // Use a system temp dir to avoid cluttering the project directory
  private readonly tmpDir: string

  constructor(projectId: string, kernelName: string) {
    this.tmpDir = path.join(os.tmpdir(), 'steward-kernels', projectId, kernelName, 'cpp-tmp')
  }

  run({ cellId, source, onLine, onCompile, signal }: RunOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('aborted')); return }

      fs.mkdirSync(this.tmpDir, { recursive: true })

      const srcFile = path.join(this.tmpDir, `${cellId}.cpp`)
      const binFile = path.join(this.tmpDir, `${cellId}.bin`)

      fs.writeFileSync(srcFile, source)

      const compiler = spawn('g++', ['-std=c++17', '-Wall', '-o', binFile, srcFile])

      let compileOutput = ''
      compiler.stdout.on('data', (d: Buffer) => { compileOutput += d.toString() })
      compiler.stderr.on('data', (d: Buffer) => { compileOutput += d.toString() })

      compiler.on('close', (compileCode) => {
        const compileOk = compileCode === 0
        onCompile?.(compileOk, compileOutput)

        if (!compileOk) {
          reject(new Error('Compile failed'))
          return
        }

        if (signal?.aborted) { reject(new Error('aborted')); return }

        const runner = spawn(binFile, [], { stdio: ['ignore', 'pipe', 'pipe'] })

        runner.stdout.on('data', (d: Buffer) => {
          for (const line of d.toString().split('\n')) {
            if (line) onLine(line)
          }
        })
        runner.stderr.on('data', (d: Buffer) => {
          for (const line of d.toString().split('\n')) {
            if (line) onLine(`[stderr] ${line}`)
          }
        })

        signal?.addEventListener('abort', () => runner.kill(), { once: true })

        runner.on('close', (runCode) => {
          try { fs.unlinkSync(binFile) } catch { /* ignore */ }
          try { fs.unlinkSync(srcFile) } catch { /* ignore */ }

          if (runCode === 0 || signal?.aborted) { resolve() }
          else { reject(new Error(`Process exited with code ${runCode}`)) }
        })

        runner.on('error', reject)
      })

      compiler.on('error', (err) => {
        onCompile?.(false, `Failed to invoke g++: ${err.message}`)
        reject(err)
      })
    })
  }

  async reset(): Promise<void> {}
  kill(): void {}
  get pid(): number | null { return null }
  get alive(): boolean { return true }
}
