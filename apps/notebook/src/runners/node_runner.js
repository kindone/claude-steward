#!/usr/bin/env node
/**
 * Persistent Node.js kernel for the notebook.
 * Protocol (stdin):  RUN <cellId> <base64-encoded source>\n
 * Protocol (stdout): ... output lines ...
 *                    DONE <cellId>\n   or   ERR <cellId>\n
 */
import { createContext, Script } from 'node:vm'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { Buffer } from 'node:buffer'
import process from 'node:process'

// Build a require function rooted at cwd so cells can require npm packages
const _require = createRequire(process.cwd() + '/node_modules/')

// Shared context — variables persist between cells
const ctx = createContext({
  console,
  process,
  Buffer,
  setTimeout,
  setInterval,
  clearTimeout,
  clearInterval,
  setImmediate,
  clearImmediate,
  require: _require,
  __dirname: process.cwd(),
  __filename: process.cwd() + '/kernel.js',
})

const rl = createInterface({ input: process.stdin })

rl.on('line', async (line) => {
  line = line.trim()
  if (!line) return

  const parts = line.split(' ')
  const cmd = parts[0]

  if (cmd === 'RUN' && parts.length >= 3) {
    const cellId = parts[1]
    const b64 = parts[2]

    let source
    try {
      source = Buffer.from(b64, 'base64').toString('utf8')
    } catch (e) {
      process.stdout.write(`[kernel] failed to decode: ${e.message}\n`)
      process.stdout.write(`ERR ${cellId}\n`)
      return
    }

    try {
      const script = new Script(source, { filename: `cell_${cellId}` })
      const result = script.runInContext(ctx)
      // Await if the result is a promise
      if (result instanceof Promise) {
        await result
      } else if (result !== undefined) {
        // Print non-undefined return values (like a REPL would)
        process.stdout.write(String(result) + '\n')
      }
      process.stdout.write(`DONE ${cellId}\n`)
    } catch (e) {
      process.stdout.write(e.stack ?? String(e))
      process.stdout.write('\n')
      process.stdout.write(`ERR ${cellId}\n`)
    }

  } else if (cmd === 'RESET') {
    // Clear the context by deleting user-defined keys
    for (const key of Object.keys(ctx)) {
      if (!['console','process','Buffer','setTimeout','setInterval',
            'clearTimeout','clearInterval','setImmediate','clearImmediate',
            'require','__dirname','__filename'].includes(key)) {
        delete ctx[key]
      }
    }
    process.stdout.write('RESET_DONE\n')
  }
})
