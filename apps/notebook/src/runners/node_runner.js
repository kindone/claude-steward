#!/usr/bin/env node
/**
 * Persistent Node.js kernel for the notebook.
 * Protocol (stdin):  RUN <cellId> <base64-encoded source>\n
 *                    RESET\n
 * Protocol (stdout): ... output lines ...
 *                    DONE <cellId>\n   or   ERR <cellId>\n
 *
 * Timer tracking: setTimeout/setInterval in the vm context are wrapped so the
 * runner knows when all async work is done before sending the DONE sentinel.
 * This allows timer-based code (debounce demos, polling loops, etc.) to fully
 * execute before the cell is considered complete.
 */
import { createContext, Script } from 'node:vm'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { Buffer } from 'node:buffer'
import process from 'node:process'

const _require = createRequire(process.cwd() + '/node_modules/')

// ── Timer tracking ────────────────────────────────────────────────────────────
// Per-cell state. Incremented each run so stale callbacks from a previous
// run don't accidentally trigger idle detection for the current run.
let _gen = 0
const _timeouts = new Set()
const _intervals = new Set()
let _idleResolve = null

function _checkIdle(gen) {
  if (gen !== _gen) return  // stale callback from a previous cell — ignore
  if (_timeouts.size === 0 && _intervals.size === 0 && _idleResolve) {
    const r = _idleResolve
    _idleResolve = null
    r()
  }
}

function _wrapSetTimeout(fn, delay, ...args) {
  const gen = _gen
  const id = setTimeout(() => {
    _timeouts.delete(id)
    try { fn(...args) } finally { _checkIdle(gen) }
  }, delay ?? 0)
  _timeouts.add(id)
  return id
}

function _wrapClearTimeout(id) {
  clearTimeout(id)
  _timeouts.delete(id)
  _checkIdle(_gen)
}

function _wrapSetInterval(fn, delay, ...args) {
  const id = setInterval(fn, delay ?? 0, ...args)
  _intervals.add(id)
  return id
}

function _wrapClearInterval(id) {
  clearInterval(id)
  _intervals.delete(id)
  _checkIdle(_gen)
}

// ── Shared vm context ─────────────────────────────────────────────────────────
// Variables assigned via `var` or globalThis persist between cells.
// `const`/`let` are wrapped in an IIFE per run, so they don't accumulate.
const BASE_KEYS = new Set([
  'console', 'process', 'Buffer',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'setImmediate', 'clearImmediate',
  'require', '__dirname', '__filename',
])

const ctx = createContext({
  console,
  process,
  Buffer,
  setTimeout: _wrapSetTimeout,
  setInterval: _wrapSetInterval,
  clearTimeout: _wrapClearTimeout,
  clearInterval: _wrapClearInterval,
  setImmediate,
  clearImmediate,
  require: _require,
  __dirname: process.cwd(),
  __filename: process.cwd() + '/kernel.js',
})

// ── Main loop ─────────────────────────────────────────────────────────────────
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

    // New generation — stale timer callbacks from previous runs are ignored
    _gen++
    const gen = _gen
    _timeouts.clear()
    _intervals.clear()
    _idleResolve = null

    // Resolves when all tracked timers have fired or been cleared
    const idlePromise = new Promise(resolve => { _idleResolve = resolve })

    // Safety net: force-resolve after 30s so we never hang indefinitely
    const safetyTimer = setTimeout(() => {
      if (_gen === gen && _idleResolve) {
        const r = _idleResolve
        _idleResolve = null
        r()
      }
    }, 30_000)

    try {
      // IIFE wrap: keeps const/let function-scoped so re-running a cell
      // doesn't throw "Identifier already declared".
      const wrapped = `(async () => {\n${source}\n})()`
      const script = new Script(wrapped, { filename: `cell_${cellId}` })
      const result = script.runInContext(ctx)

      // Thenable check — vm context has its own Promise, instanceof fails
      if (result !== null && result !== undefined && typeof result.then === 'function') {
        await result
      }

      // Trigger idle check — resolves immediately if no timers were registered
      _checkIdle(gen)

      await idlePromise
      clearTimeout(safetyTimer)
      process.stdout.write(`DONE ${cellId}\n`)
    } catch (e) {
      clearTimeout(safetyTimer)
      _idleResolve = null
      process.stdout.write(e.stack ?? String(e))
      process.stdout.write('\n')
      process.stdout.write(`ERR ${cellId}\n`)
    }

  } else if (cmd === 'RESET') {
    _gen++
    _timeouts.clear()
    _intervals.clear()
    _idleResolve = null
    for (const key of Object.keys(ctx)) {
      if (!BASE_KEYS.has(key)) delete ctx[key]
    }
    process.stdout.write('RESET_DONE\n')
  }
})
