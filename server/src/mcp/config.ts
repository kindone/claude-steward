/**
 * Writes the steward-mcp.json config file consumed by Claude CLI's --mcp-config flag.
 *
 * Called once at server startup (index.ts). The file path is stored in
 * MCP_CONFIG_PATH env var, which is inherited by the worker process and used
 * when spawning Claude CLI subprocesses.
 *
 * In production: command = "node", args = ["<dist>/mcp/schedule-server.js"]
 * In dev (NODE_ENV !== 'production'): command = "npx", args = ["tsx", "<src>/mcp/schedule-server.ts"]
 * This avoids a chicken-and-egg issue where the dev server starts before a build exists.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Path to the generated MCP config JSON file. */
export const MCP_CONFIG_PATH = path.join(__dirname, '../../data/steward-mcp.json')

/** Path where the MCP notify secret is persisted across server restarts. */
const MCP_SECRET_PATH = path.join(__dirname, '../../data/mcp-secret.txt')

/**
 * Return a stable MCP notify secret that survives server restarts.
 *
 * Priority:
 *   1. process.env.MCP_NOTIFY_SECRET (set earlier in this process lifetime)
 *   2. data/mcp-secret.txt (persisted from a previous run)
 *   3. Fresh random secret — written to disk so next restart reuses it
 *
 * Without persistence, every `pm2 restart steward-main` generates a new secret.
 * The running Claude Code session's MCP subprocess still holds the old secret,
 * so its /api/mcp-notify POSTs get 401'd and SSE notifications are silently lost.
 */
function getMcpSecret(): string {
  if (process.env.MCP_NOTIFY_SECRET) return process.env.MCP_NOTIFY_SECRET

  const dataDir = path.dirname(MCP_SECRET_PATH)
  fs.mkdirSync(dataDir, { recursive: true })

  if (fs.existsSync(MCP_SECRET_PATH)) {
    const stored = fs.readFileSync(MCP_SECRET_PATH, 'utf8').trim()
    if (stored) {
      process.env.MCP_NOTIFY_SECRET = stored
      return stored
    }
  }

  const secret = randomBytes(32).toString('hex')
  fs.writeFileSync(MCP_SECRET_PATH, secret, { mode: 0o600 })
  process.env.MCP_NOTIFY_SECRET = secret
  return secret
}

/**
 * Write the MCP config file and export MCP_CONFIG_PATH and MCP_NOTIFY_SECRET
 * as process.env vars so worker processes inherit them via the cleanEnv pass-through.
 */
export function writeMcpConfig(): void {
  const port   = process.env.PORT ?? '3001'
  const dbPath = process.env.DATABASE_PATH ?? path.join(__dirname, '../../steward.db')
  const notifyUrl    = `http://localhost:${port}/api/mcp-notify`
  const notifySecret = getMcpSecret()

  // Ensure data/ directory exists
  const dataDir = path.dirname(MCP_CONFIG_PATH)
  fs.mkdirSync(dataDir, { recursive: true })

  const isProd = process.env.NODE_ENV === 'production'
  const scheduleEntry = isProd
    ? path.join(__dirname, '../mcp/schedule-server.js')    // dist/mcp/schedule-server.js
    : path.join(__dirname, 'schedule-server.ts')            // src/mcp/schedule-server.ts
  const artifactEntry = isProd
    ? path.join(__dirname, '../mcp/artifact-server.js')    // dist/mcp/artifact-server.js
    : path.join(__dirname, 'artifact-server.ts')            // src/mcp/artifact-server.ts

  // Use the absolute path to the current Node.js binary so MCP servers inherit
  // the same version the steward server runs on (NVM-managed v22+, required for
  // node:sqlite). Without this, Claude Code spawns MCP servers using the system
  // node (often v18) which doesn't have node:sqlite and crashes on import.
  const nodeBin = process.execPath

  const sharedEnv = {
    DATABASE_PATH:     dbPath,
    MCP_NOTIFY_URL:    notifyUrl,
    MCP_NOTIFY_SECRET: notifySecret,
  }

  function makeServer(entry: string): StewardMcpServer {
    return isProd
      ? { type: 'stdio', command: nodeBin, args: [entry],                       env: sharedEnv }
      : { type: 'stdio', command: nodeBin, args: ['--import', 'tsx', entry],    env: sharedEnv }
  }

  const mcpConfig = {
    mcpServers: {
      'steward-schedules': makeServer(scheduleEntry),
      'steward-artifacts': makeServer(artifactEntry),
    },
  }

  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(mcpConfig, null, 2))

  // Export so worker inherits via cleanEnv (cleanEnv strips CLAUDE* only, not MCP*)
  process.env.MCP_CONFIG_PATH    = MCP_CONFIG_PATH
  process.env.MCP_NOTIFY_SECRET  = notifySecret

  // Each CLI reads MCP server registrations from a different place with a
  // different schema. We mirror the canonical config (the steward-mcp.json
  // we just wrote) into both so whichever CLI the user picks sees the same
  // servers with the same secrets and entry points.
  //   - Claude Code reads ~/.claude.json (its own format)
  //   - opencode    reads $XDG_CONFIG_HOME/opencode/opencode.json (different format)
  // Both sync calls are silent no-ops if the destination is unreachable.
  syncClaudeSettings(mcpConfig.mcpServers)
  syncOpencodeSettings(mcpConfig.mcpServers)

  console.log(`[mcp] config written → ${MCP_CONFIG_PATH} (notify: ${notifyUrl})`)
}

/** Shape of an MCP server entry written by makeServer above. Exported so
 *  tests can construct fixtures matching what the public API produces. */
export type StewardMcpServer = {
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * Update steward MCP server entries in ~/.claude.json — the file Claude Code
 * uses to store MCP server registrations (written by `claude mcp add`).
 * This keeps secrets and node binary paths in sync across server restarts.
 */
function syncClaudeSettings(servers: Record<string, StewardMcpServer>): void {
  const claudeJson = path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? '~',
    '.claude.json',
  )
  if (!fs.existsSync(claudeJson)) return
  try {
    const raw = fs.readFileSync(claudeJson, 'utf8')
    const data = JSON.parse(raw)
    data.mcpServers ??= {}
    for (const [name, config] of Object.entries(servers)) {
      data.mcpServers[name] = config
    }
    fs.writeFileSync(claudeJson, JSON.stringify(data, null, 2) + '\n')
  } catch (err) {
    // Non-fatal — a stale secret just means SSE notify won't fire until next restart.
    console.warn('[mcp] could not sync ~/.claude.json:', err)
  }
}

/**
 * Update steward MCP server entries in opencode's config file. opencode reads
 * `$XDG_CONFIG_HOME/opencode/opencode.json` (or `$HOME/.config/opencode/
 * opencode.json` if XDG_CONFIG_HOME is unset).
 *
 * Schema differs from Claude's:
 *   Claude:   { type: 'stdio', command: 'node', args: ['x.js'], env: {...} }
 *   Opencode: { type: 'local',  command: ['node', 'x.js'],     environment: {...} }
 *
 * Unlike syncClaudeSettings (which silently skips a missing file), this
 * creates the config dir + file if absent — opencode doesn't ship a default
 * file, so a missing file is the common case rather than the exceptional one.
 *
 * Existing user config is preserved: we only overwrite the `mcp.<name>`
 * entries we own, leaving any other top-level keys (model defaults, theme,
 * provider settings) and unrelated MCP servers untouched.
 */
export function syncOpencodeSettings(servers: Record<string, StewardMcpServer>): void {
  const xdg = process.env.XDG_CONFIG_HOME
  const home = process.env.HOME ?? process.env.USERPROFILE
  if (!xdg && !home) return  // no writable user config root — give up

  const configDir = xdg
    ? path.join(xdg, 'opencode')
    : path.join(home as string, '.config', 'opencode')
  const configPath = path.join(configDir, 'opencode.json')

  try {
    fs.mkdirSync(configDir, { recursive: true })

    // Read existing config so we preserve user customizations + non-steward
    // MCP servers. Treat parse errors as "start fresh" rather than crashing —
    // a malformed user config is the user's problem, not ours, and we don't
    // want to block server startup on it.
    let existing: { $schema?: string; mcp?: Record<string, unknown>;[k: string]: unknown } = {}
    if (fs.existsSync(configPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      } catch {
        existing = {}
      }
    }

    existing.$schema ??= 'https://opencode.ai/config.json'
    existing.mcp ??= {}

    for (const [name, srv] of Object.entries(servers)) {
      existing.mcp[name] = {
        type: 'local',
        command: [srv.command, ...srv.args],
        environment: srv.env,
      }
    }

    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n')
  } catch (err) {
    // Non-fatal — opencode just won't see the steward MCP tools.
    console.warn('[mcp] could not sync opencode config:', err)
  }
}
