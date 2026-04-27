// Feature:     syncOpencodeSettings — keeps opencode's MCP server registrations
//              in sync with the canonical steward-mcp.json each time the server
//              boots. Without it, the in-container opencode CLI emits
//              "Model tried to call unavailable tool 'artifact_create'" and
//              users can't drive steward-side state from chat.
// Arch/Design: Mirrors syncClaudeSettings but for opencode's different schema
//              (`mcp` vs `mcpServers`, `command:[…]` array vs `command + args`
//              split, `environment` vs `env`) and config path
//              ($XDG_CONFIG_HOME/opencode/opencode.json).
// Spec:
//   ∀ servers: writes opencode-shaped entry under existing.mcp[name] with
//     type:'local', command:[srv.command, ...srv.args], environment:srv.env.
//   Creates the config dir if missing (opencode ships no default file).
//   Preserves unrelated top-level keys (model, theme, …) and unrelated MCP
//     servers — only steward-owned names are overwritten.
//   Adds $schema if absent; preserves it if present.
//   Malformed existing JSON → silent reset (don't crash startup).
//   No HOME and no XDG_CONFIG_HOME → silent no-op (no throw).
// @quality:    correctness, refactor-safety
// @type:       example

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { syncOpencodeSettings, type StewardMcpServer } from '../../mcp/config.js'

// Each test gets a fresh tmp XDG_CONFIG_HOME so concurrent runs and host
// state stay isolated. We restore the original env afterward — the setup
// file in __tests__/setup.ts doesn't manage XDG_CONFIG_HOME.
const ENV_KEYS = ['XDG_CONFIG_HOME', 'HOME', 'USERPROFILE'] as const
let savedEnv: Partial<Record<typeof ENV_KEYS[number], string | undefined>> = {}
let tmpRoot = ''

function fixturePair(): Record<string, StewardMcpServer> {
  return {
    'steward-schedules': {
      type: 'stdio',
      command: '/usr/local/bin/node',
      args: ['/app/server/dist/mcp/schedule-server.js'],
      env: { DATABASE_PATH: '/data/steward.db', MCP_NOTIFY_SECRET: 'abc' },
    },
    'steward-artifacts': {
      type: 'stdio',
      command: '/usr/local/bin/node',
      args: ['/app/server/dist/mcp/artifact-server.js'],
      env: { DATABASE_PATH: '/data/steward.db', MCP_NOTIFY_SECRET: 'abc' },
    },
  }
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-opencode-'))
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  // Default: route the function at $tmpRoot/opencode/opencode.json via XDG.
  process.env.XDG_CONFIG_HOME = tmpRoot
  delete process.env.HOME
  delete process.env.USERPROFILE
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* ignore */ }
})

function readWritten(): unknown {
  const p = path.join(tmpRoot, 'opencode', 'opencode.json')
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

describe('syncOpencodeSettings', () => {
  it('translates Claude schema to opencode schema (command split → array, env → environment)', () => {
    syncOpencodeSettings(fixturePair())
    const written = readWritten() as {
      $schema: string
      mcp: Record<string, { type: string; command: string[]; environment: Record<string, string> }>
    }
    expect(written.$schema).toBe('https://opencode.ai/config.json')
    expect(written.mcp['steward-schedules']).toEqual({
      type: 'local',
      command: ['/usr/local/bin/node', '/app/server/dist/mcp/schedule-server.js'],
      environment: { DATABASE_PATH: '/data/steward.db', MCP_NOTIFY_SECRET: 'abc' },
    })
    expect(written.mcp['steward-artifacts']).toEqual({
      type: 'local',
      command: ['/usr/local/bin/node', '/app/server/dist/mcp/artifact-server.js'],
      environment: { DATABASE_PATH: '/data/steward.db', MCP_NOTIFY_SECRET: 'abc' },
    })
  })

  it('creates the config directory when it does not exist', () => {
    const dir = path.join(tmpRoot, 'opencode')
    expect(fs.existsSync(dir)).toBe(false)
    syncOpencodeSettings(fixturePair())
    expect(fs.existsSync(path.join(dir, 'opencode.json'))).toBe(true)
  })

  it('preserves unrelated top-level user keys', () => {
    const dir = path.join(tmpRoot, 'opencode')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      model: 'anthropic/claude-sonnet-4',
      theme: 'mono-dark',
      mcp: {},
    }))

    syncOpencodeSettings(fixturePair())
    const written = readWritten() as { model: string; theme: string }
    expect(written.model).toBe('anthropic/claude-sonnet-4')
    expect(written.theme).toBe('mono-dark')
  })

  it('preserves unrelated MCP servers (only overwrites steward-owned names)', () => {
    const dir = path.join(tmpRoot, 'opencode')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({
      mcp: {
        'user-tool': { type: 'local', command: ['my-binary'], environment: { FOO: 'bar' } },
        'steward-schedules': { type: 'local', command: ['stale'], environment: {} },
      },
    }))

    syncOpencodeSettings(fixturePair())
    const written = readWritten() as { mcp: Record<string, { command: string[] }> }
    expect(written.mcp['user-tool']).toEqual({
      type: 'local',
      command: ['my-binary'],
      environment: { FOO: 'bar' },
    })
    // steward-schedules must be overwritten with the fresh registration
    expect(written.mcp['steward-schedules'].command).toEqual([
      '/usr/local/bin/node',
      '/app/server/dist/mcp/schedule-server.js',
    ])
  })

  it('preserves an existing $schema rather than stomping it', () => {
    const dir = path.join(tmpRoot, 'opencode')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({
      $schema: 'file:///custom/schema.json',
      mcp: {},
    }))

    syncOpencodeSettings(fixturePair())
    const written = readWritten() as { $schema: string }
    expect(written.$schema).toBe('file:///custom/schema.json')
  })

  it('treats malformed existing JSON as a fresh start (does not throw)', () => {
    const dir = path.join(tmpRoot, 'opencode')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'opencode.json'), '{not valid json')

    expect(() => syncOpencodeSettings(fixturePair())).not.toThrow()
    const written = readWritten() as { mcp: Record<string, unknown> }
    expect(Object.keys(written.mcp).sort()).toEqual(['steward-artifacts', 'steward-schedules'])
  })

  it('falls back to $HOME/.config/opencode when XDG_CONFIG_HOME is unset', () => {
    delete process.env.XDG_CONFIG_HOME
    process.env.HOME = tmpRoot

    syncOpencodeSettings(fixturePair())
    const fallbackPath = path.join(tmpRoot, '.config', 'opencode', 'opencode.json')
    expect(fs.existsSync(fallbackPath)).toBe(true)
  })

  it('is a silent no-op when neither HOME nor XDG_CONFIG_HOME is set', () => {
    delete process.env.XDG_CONFIG_HOME
    delete process.env.HOME
    delete process.env.USERPROFILE
    expect(() => syncOpencodeSettings(fixturePair())).not.toThrow()
    // Nothing should have been written under tmpRoot
    expect(fs.existsSync(path.join(tmpRoot, 'opencode'))).toBe(false)
  })

  it('writes idempotently — repeated calls produce the same output', () => {
    syncOpencodeSettings(fixturePair())
    const first = fs.readFileSync(path.join(tmpRoot, 'opencode', 'opencode.json'), 'utf8')
    syncOpencodeSettings(fixturePair())
    const second = fs.readFileSync(path.join(tmpRoot, 'opencode', 'opencode.json'), 'utf8')
    expect(second).toBe(first)
  })
})
