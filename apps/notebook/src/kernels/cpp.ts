import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { IKernel, RunOptions } from './types.js'

export class CppKernel implements IKernel {
  constructor(private readonly dataDir: string) {}

  run({ cellId, source, onLine, onCompile, signal }: RunOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('aborted')); return }

      const tmpDir = path.join(this.dataDir, 'kernels', 'tmp')
      fs.mkdirSync(tmpDir, { recursive: true })

      const srcFile = path.join(tmpDir, `${cellId}.cpp`)
      const binFile = path.join(tmpDir, `${cellId}.bin`)

      fs.writeFileSync(srcFile, source)

      // Compile
      const compiler = spawn('g++', ['-std=c++17', '-Wall', '-o', binFile, srcFile], {
        cwd: this.dataDir,
      })

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

        // Run the binary
        const runner = spawn(binFile, [], {
          cwd: this.dataDir,
          stdio: ['ignore', 'pipe', 'pipe'],
        })

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
          // Clean up binary
          try { fs.unlinkSync(binFile) } catch { /* ignore */ }
          try { fs.unlinkSync(srcFile) } catch { /* ignore */ }

          if (runCode === 0 || signal?.aborted) {
            resolve()
          } else {
            reject(new Error(`Process exited with code ${runCode}`))
          }
        })

        runner.on('error', reject)
      })

      compiler.on('error', (err) => {
        onCompile?.(false, `Failed to invoke g++: ${err.message}`)
        reject(err)
      })
    })
  }

  // C++ is stateless — reset is a no-op
  async reset(): Promise<void> {}
  kill(): void {}
  get pid(): number | null { return null }
  get alive(): boolean { return true } // always "alive" — no persistent process
}
