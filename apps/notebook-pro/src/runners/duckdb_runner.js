#!/usr/bin/env node
/**
 * Persistent DuckDB kernel for the notebook.
 *
 * Protocol (stdin):  RUN <cellId> <base64-encoded SQL>\n
 *                    RESET\n
 * Protocol (stdout): ... output lines (NBOUT:table:... or plain text) ...
 *                    DONE <cellId>\n   or   ERR <cellId>\n
 *
 * One DuckDB instance per kernel process, backed by workspace/notebook.duckdb.
 * SELECT-like statements emit results as NBOUT:table:<base64-json>.
 * DDL/DML statements emit a plain-text summary (e.g. "Created table foo").
 *
 * Supports all DuckDB shorthand:
 *   SELECT * FROM 'workspace/data.parquet'
 *   SELECT * FROM read_csv('workspace/data.csv')
 *   COPY (...) TO 'workspace/out.parquet' (FORMAT PARQUET)
 */
import { DuckDBInstance } from '@duckdb/node-api'
import { createInterface } from 'node:readline'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import process from 'node:process'

const DB_PATH = path.join(process.cwd(), 'workspace', 'notebook.duckdb')

let db = null
let conn = null

async function ensureConnected() {
  if (conn) return
  db = await DuckDBInstance.create(DB_PATH)
  conn = await db.connect()
}

/** Returns true if the statement looks like it returns rows. */
function isRowReturning(sql) {
  const trimmed = sql.trimStart().toUpperCase()
  return (
    trimmed.startsWith('SELECT') ||
    trimmed.startsWith('WITH') ||
    trimmed.startsWith('SHOW') ||
    trimmed.startsWith('DESCRIBE') ||
    trimmed.startsWith('EXPLAIN') ||
    trimmed.startsWith('PRAGMA') ||
    trimmed.startsWith('FROM') ||
    trimmed.startsWith('SUMMARIZE') ||
    trimmed.startsWith('PIVOT') ||
    trimmed.startsWith('UNPIVOT')
  )
}

/** Split multiple statements on ';' but handle strings/identifiers naively. */
function splitStatements(sql) {
  // Simple split — good enough for notebook use; doesn't handle SQL strings with ';'
  return sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

async function runSql(cellId, sql) {
  await ensureConnected()

  const statements = splitStatements(sql)

  for (const stmt of statements) {
    let result
    try {
      result = await conn.run(stmt)
    } catch (err) {
      process.stdout.write(`${err.message}\n`)
      process.stdout.write(`ERR ${cellId}\n`)
      return
    }

    // Check if we got rows back
    let rows
    try {
      rows = await result.getRowObjects()
    } catch {
      rows = null
    }

    if (rows && rows.length > 0) {
      // Emit as NBOUT table
      const payload = Buffer.from(JSON.stringify(rows)).toString('base64')
      process.stdout.write(`NBOUT:table:${payload}\n`)
    } else if (rows && rows.length === 0) {
      // SELECT with zero results — still show as empty table with column names
      // Get column names from the result chunk
      const chunk = await result.fetchChunk().catch(() => null)
      if (chunk && chunk.columnCount > 0) {
        // Build an empty table with headers via a single dummy row trick
        // Emit a note instead — zero rows
        process.stdout.write(`(0 rows)\n`)
      } else {
        // DDL/DML — try to get affected row count or just say "OK"
        process.stdout.write(`OK\n`)
      }
    } else {
      process.stdout.write(`OK\n`)
    }
  }

  process.stdout.write(`DONE ${cellId}\n`)
}

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

    let sql
    try {
      sql = Buffer.from(b64, 'base64').toString('utf8')
    } catch (e) {
      process.stdout.write(`[duckdb] failed to decode: ${e.message}\n`)
      process.stdout.write(`ERR ${cellId}\n`)
      return
    }

    await runSql(cellId, sql)

  } else if (cmd === 'RESET') {
    // Close and reopen the connection (clears session state like temp tables)
    if (conn) {
      try { conn.close?.() } catch {}
      conn = null
    }
    if (db) {
      try { await db.close?.() } catch {}
      db = null
    }
    process.stdout.write('RESET_DONE\n')
  }
})
