import { spawn, type ChildProcess } from 'node:child_process'

// Defaults to whatever `mkdocs` resolves to on PATH. Override via
// MKDOCS_PATH for non-PATH installs (e.g. a Python virtualenv).
const MKDOCS_BIN = process.env.MKDOCS_PATH ?? 'mkdocs'

let child: ChildProcess | null = null
let internalPort = 18765  // default; overridden by startMkDocs(docsDir, port)

export function startMkDocs(docsDir: string, port?: number): Promise<void> {
  if (port !== undefined) internalPort = port
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('MkDocs failed to start within 15s')), 15_000)

    child = spawn(MKDOCS_BIN, [
      'serve',
      '--dev-addr', `127.0.0.1:${internalPort}`,
      '--livereload',   // explicit; WS upgrades are proxied in server.ts
    ], {
      cwd: docsDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout?.on('data', (d: Buffer) => {
      const text = d.toString()
      process.stdout.write(`[mkdocs] ${text}`)
      // MkDocs prints "Serving on http://..." when ready
      if (text.includes('Serving on') || text.includes('Documentation built')) {
        clearTimeout(timeout)
        resolve()
      }
    })

    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString()
      process.stderr.write(`[mkdocs] ${text}`)
      if (text.includes('Serving on') || text.includes('Documentation built')) {
        clearTimeout(timeout)
        resolve()
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error(`Failed to start MkDocs: ${err.message}`))
    })

    child.on('exit', (code) => {
      child = null
      if (code !== 0) console.error(`[mkdocs] exited with code ${code}`)
    })
  })
}

export function stopMkDocs(): void {
  if (child) {
    child.kill('SIGTERM')
    child = null
  }
}

export function getMkDocsPort(): number {
  return internalPort
}

export function isMkDocsRunning(): boolean {
  return child !== null
}
