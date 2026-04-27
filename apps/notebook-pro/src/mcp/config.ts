/**
 * Writes a per-notebook MCP config JSON file consumed by Claude CLI's --mcp-config flag.
 *
 * Called from chat.ts on each chat request. The file is written to
 * DATA_DIR/.notebook/mcp-<notebookId>.json and is stable across requests
 * for the same notebook (same content → no unnecessary disk writes in practice).
 *
 * The MCP server subprocess is passed NOTEBOOK_PORT and NOTEBOOK_ID via env vars.
 * It bridges Claude's tool calls back to the notebook's own HTTP API.
 *
 * In production (NODE_ENV=production): node dist/mcp/server.js
 * In dev: node --import tsx src/mcp/server.ts
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function writeMcpConfig(dataDir: string, port: number, notebookId: string): string {
  const isProd = process.env.NODE_ENV === 'production'

  // Use the same Node binary that runs the server (NVM-managed, required for ESM + fetch).
  const nodeBin = process.execPath

  const serverEntry = isProd
    ? path.join(__dirname, '../mcp/server.js')   // dist/mcp/server.js  (compiled)
    : path.join(__dirname, 'server.ts')           // src/mcp/server.ts   (dev via tsx)

  const mcpConfig = {
    mcpServers: {
      'notebook-pro': {
        type: 'stdio',
        command: nodeBin,
        args: isProd
          ? [serverEntry]
          : ['--import', 'tsx', serverEntry],
        env: {
          NOTEBOOK_PORT: String(port),
          NOTEBOOK_ID: notebookId,
        },
      },
    },
  }

  const configPath = path.join(dataDir, '.notebook', `mcp-${notebookId}.json`)
  fs.writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2))
  return configPath
}
