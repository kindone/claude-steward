// Feature:     Claude CLI subprocess spawn
// Arch/Design: buildCleanEnv sanitizes the env passed to `spawn(claude, ...)`.
//              All three spawn sites (main SSE, compaction, worker) use it.
// Spec:        ∀ key starting with 'CLAUDE' in output: key === 'CLAUDE_CODE_OAUTH_TOKEN'
//              ∀ env: 'ANTHROPIC_API_KEY' ∉ output
//              ∀ env with CLAUDE_CODE_OAUTH_TOKEN=X: output.CLAUDE_CODE_OAUTH_TOKEN === X
//              ∀ env with ANTHROPIC_BASE_URL=X: output.ANTHROPIC_BASE_URL === X
//              ∀ non-CLAUDE, non-ANTHROPIC_API_KEY key k in env: output[k] === env[k]
//              buildCleanEnv never mutates its input
// @quality:    correctness (prevents CLI hang + accidental API-credit billing +
//              container auth failure)
// @type:       example + property
// @mode:       verification

import { describe, it, expect } from 'vitest'
import { forAll, Gen } from 'jsproptest'
import { buildCleanEnv } from '../../claude/clean-env.js'

describe('buildCleanEnv — example cases', () => {
  it('empty env → empty result', () => {
    expect(buildCleanEnv({})).toEqual({})
  })

  it('passes through PATH, HOME, and other ordinary vars unchanged', () => {
    const env = { PATH: '/usr/bin:/bin', HOME: '/root', NODE_ENV: 'production' }
    expect(buildCleanEnv(env)).toEqual(env)
  })

  it('strips CLAUDECODE=1 (the source of the sub-agent IPC hang)', () => {
    const env = { CLAUDECODE: '1', PATH: '/usr/bin' }
    expect(buildCleanEnv(env)).toEqual({ PATH: '/usr/bin' })
  })

  it('strips every CLAUDE* except the allowlisted OAuth token', () => {
    const env = {
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-cli',
      CLAUDE_CODE_EXECPATH: '/some/path',
      CLAUDE_CODE_ACCOUNT_UUID: 'abc',
      CLAUDE_PATH: '/usr/local/bin/claude',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-KEEP-ME',
      PATH: '/usr/bin',
    }
    const out = buildCleanEnv(env)
    expect(out).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-KEEP-ME',
      PATH: '/usr/bin',
    })
  })

  it('strips ANTHROPIC_API_KEY so the CLI uses OAuth instead of API credits', () => {
    const env = {
      ANTHROPIC_API_KEY: 'sk-ant-api-LEAKED',
      ANTHROPIC_BASE_URL: 'https://api.example.com',
      PATH: '/usr/bin',
    }
    const out = buildCleanEnv(env)
    expect(out).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(out.ANTHROPIC_BASE_URL).toBe('https://api.example.com')
    expect(out.PATH).toBe('/usr/bin')
  })

  it('preserves ANTHROPIC_BASE_URL (endpoint override must survive)', () => {
    const env = { ANTHROPIC_BASE_URL: 'https://proxy.example.com' }
    expect(buildCleanEnv(env).ANTHROPIC_BASE_URL).toBe('https://proxy.example.com')
  })

  it('preserves CLAUDE_CODE_OAUTH_TOKEN (required for containerized auth)', () => {
    const env = { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-abc123' }
    expect(buildCleanEnv(env).CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-abc123')
  })

  it('does not mutate the input env', () => {
    const env = { CLAUDECODE: '1', ANTHROPIC_API_KEY: 'x', PATH: '/bin' }
    const snapshot = { ...env }
    buildCleanEnv(env)
    expect(env).toEqual(snapshot)
  })

  it('skips undefined values (NodeJS.ProcessEnv allows undefined)', () => {
    const env = { FOO: undefined, BAR: 'baz' } as NodeJS.ProcessEnv
    const out = buildCleanEnv(env)
    expect(out).not.toHaveProperty('FOO')
    expect(out.BAR).toBe('baz')
  })
})

describe('buildCleanEnv — property tests', () => {
  // Source for generating realistic env fixtures: arbitrary string keys + values.
  // Length ≥ 1 for keys (empty keys can't exist in real env).
  const envGen = Gen.dictionary(Gen.asciiString(1, 20), Gen.asciiString(0, 30), 0, 15)

  it('∀ output key: key does not start with CLAUDE, OR key === CLAUDE_CODE_OAUTH_TOKEN', () => {
    forAll(
      (env: Record<string, string>) => {
        const out = buildCleanEnv(env as NodeJS.ProcessEnv)
        return Object.keys(out).every(
          (k) => !k.startsWith('CLAUDE') || k === 'CLAUDE_CODE_OAUTH_TOKEN',
        )
      },
      envGen,
    )
  })

  it('∀ env: ANTHROPIC_API_KEY is never in the output', () => {
    forAll(
      (env: Record<string, string>, apiKey: string) => {
        const envWithKey = { ...env, ANTHROPIC_API_KEY: apiKey }
        return !('ANTHROPIC_API_KEY' in buildCleanEnv(envWithKey as NodeJS.ProcessEnv))
      },
      envGen,
      Gen.asciiString(0, 50),
    )
  })

  it('∀ non-CLAUDE, non-ANTHROPIC_API_KEY key: value is preserved', () => {
    forAll(
      (key: string, value: string) => {
        // Property only claims something for the complement set — skip otherwise.
        if (key.startsWith('CLAUDE')) return true
        if (key === 'ANTHROPIC_API_KEY') return true
        const env: NodeJS.ProcessEnv = { [key]: value }
        return buildCleanEnv(env)[key] === value
      },
      Gen.asciiString(1, 20),
      Gen.asciiString(0, 50),
    )
  })

  it('∀ env: output is a strict subset of input keys (no invented keys)', () => {
    forAll(
      (env: Record<string, string>) => {
        const inputKeys = new Set(Object.keys(env))
        return Object.keys(buildCleanEnv(env as NodeJS.ProcessEnv)).every((k) => inputKeys.has(k))
      },
      envGen,
    )
  })
})
