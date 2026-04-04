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

/**
 * Generate or reuse a stable MCP notify secret.
 * Stored in MCP_NOTIFY_SECRET env var if already set (e.g. across restarts),
 * otherwise generated fresh and written back to process.env so it's consistent
 * within this process lifetime.
 */
function getMcpSecret(): string {
  if (process.env.MCP_NOTIFY_SECRET) return process.env.MCP_NOTIFY_SECRET
  const secret = randomBytes(32).toString('hex')
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
  const serverEntry = isProd
    ? path.join(__dirname, '../mcp/schedule-server.js')    // dist/mcp/schedule-server.js
    : path.join(__dirname, 'schedule-server.ts')            // src/mcp/schedule-server.ts

  // Use the absolute path to the current Node.js binary so MCP servers inherit
  // the same version the steward server runs on (NVM-managed v22+, required for
  // node:sqlite). Without this, Claude Code spawns MCP servers using the system
  // node (often v18) which doesn't have node:sqlite and crashes on import.
  const nodeBin = process.execPath

  const mcpConfig = {
    mcpServers: {
      'steward-schedules': isProd
        ? {
            type: 'stdio',
            command: nodeBin,
            args: [serverEntry],
            env: {
              DATABASE_PATH:     dbPath,
              MCP_NOTIFY_URL:    notifyUrl,
              MCP_NOTIFY_SECRET: notifySecret,
            },
          }
        : {
            type: 'stdio',
            command: nodeBin,
            args: ['--import', 'tsx', serverEntry],
            env: {
              DATABASE_PATH:     dbPath,
              MCP_NOTIFY_URL:    notifyUrl,
              MCP_NOTIFY_SECRET: notifySecret,
            },
          },
    },
  }

  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(mcpConfig, null, 2))

  // Export so worker inherits via cleanEnv (cleanEnv strips CLAUDE* only, not MCP*)
  process.env.MCP_CONFIG_PATH    = MCP_CONFIG_PATH
  process.env.MCP_NOTIFY_SECRET  = notifySecret

  // Keep .claude/settings.json in sync so the Claude Code session always has the
  // current secret and server entry point. Silently skip if the file doesn't exist.
  syncClaudeSettings(mcpConfig.mcpServers['steward-schedules'])

  console.log(`[mcp] config written → ${MCP_CONFIG_PATH} (notify: ${notifyUrl})`)
}

/**
 * Update the steward-schedules entry in ~/.claude.json — the file Claude Code
 * uses to store MCP server registrations (written by `claude mcp add`).
 * This keeps the secret and node binary path in sync across server restarts.
 */
function syncClaudeSettings(serverConfig: object): void {
  const claudeJson = path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? '~',
    '.claude.json',
  )
  if (!fs.existsSync(claudeJson)) return
  try {
    const raw = fs.readFileSync(claudeJson, 'utf8')
    const data = JSON.parse(raw)
    data.mcpServers ??= {}
    data.mcpServers['steward-schedules'] = serverConfig
    fs.writeFileSync(claudeJson, JSON.stringify(data, null, 2) + '\n')
  } catch (err) {
    // Non-fatal — a stale secret just means SSE notify won't fire until next restart.
    console.warn('[mcp] could not sync ~/.claude.json:', err)
  }
}
