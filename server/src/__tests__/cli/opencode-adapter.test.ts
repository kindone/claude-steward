// Feature:     CliAdapter abstraction (opencode implementation)
// Arch/Design: opencodeAdapter parses the opencode JSON event schema captured
//              empirically from `opencode run --format json`. Mirrors the
//              claudeAdapter contract so JobManager can switch between them
//              via STEWARD_CLI without touching spawn lifecycle.
// Spec:        Parser:
//                ∀ first event with sessionID: emits session_id (idempotent thereafter).
//                ∀ text event: emits text_block_start + text_delta with whole text.
//                ∀ tool_use(status=completed): emits tool_use AND tool_result pair.
//                ∀ tool_use with metadata.exit != 0: tool_result.isError = true.
//                ∀ step_finish(reason=stop): emits result_done with externalId.
//                step_finish(reason=tool-calls): no canonical event (intermediate).
//                step_start: no canonical event.
//                error: emits result_error with classified code + friendly message.
//              Args:
//                Always: run, then optional --dir <resolved path> when workingDirectory
//                set, then --format json, --dangerously-skip-permissions.
//                model set → --model <provider/model>.
//                resumeId set → -s <id>.
//                systemPrompt set → prepended to user message with separator.
//              Capabilities:
//                streamingTokens=false (whole-message text only).
//                toolUseStructured=true.
// @quality:    correctness, refactor-safety, schema fidelity vs captured probes
// @type:       example
// @mode:       verification

import { describe, it, expect } from 'vitest'
import { opencodeAdapter } from '../../cli/opencode-adapter.js'
import type { LaunchOptions } from '../../cli/types.js'

const baseOpts: LaunchOptions = {
  prompt: 'hello',
  resumeId: null,
  systemPrompt: null,
  permissionMode: null,
  model: null,
  mcpConfigPath: null,
}

describe('opencodeAdapter.createParser', () => {
  it('emits session_id from the first event with sessionID, then never again', () => {
    const p = opencodeAdapter.createParser(baseOpts)
    const first = p.parseLine(JSON.stringify({
      type: 'step_start',
      timestamp: 1,
      sessionID: 'ses_abc123',
      part: { id: 'prt_x', messageID: 'msg_y', sessionID: 'ses_abc123', type: 'step-start' },
    }))
    const second = p.parseLine(JSON.stringify({
      type: 'step_start',
      timestamp: 2,
      sessionID: 'ses_should_not_re_emit',
      part: { id: 'prt_z', messageID: 'msg_y', sessionID: 'ses_should_not_re_emit', type: 'step-start' },
    }))
    expect(first.events).toEqual([{ type: 'session_id', externalId: 'ses_abc123' }])
    expect(second.events).toEqual([])
  })

  it('emits text_block_start + text_delta from a text event with the full message text', () => {
    const p = opencodeAdapter.createParser(baseOpts)
    p.parseLine(JSON.stringify({ type: 'step_start', timestamp: 0, sessionID: 'ses_1', part: { id: 'p', messageID: 'm', sessionID: 'ses_1', type: 'step-start' } })) // prime session_id
    const r = p.parseLine(JSON.stringify({
      type: 'text',
      timestamp: 100,
      sessionID: 'ses_1',
      part: {
        id: 'prt_text',
        messageID: 'msg_y',
        sessionID: 'ses_1',
        type: 'text',
        text: '2+2 equals 4.',
        time: { start: 99, end: 100 },
      },
    }))
    expect(r.events).toEqual([
      { type: 'text_block_start' },
      { type: 'text_delta', text: '2+2 equals 4.' },
    ])
  })

  it('synthesizes tool_use + tool_result pair from a completed bash tool_use event', () => {
    const p = opencodeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({
      type: 'tool_use',
      timestamp: 1,
      sessionID: 'ses_1',
      part: {
        id: 'prt_tool',
        messageID: 'msg_1',
        sessionID: 'ses_1',
        type: 'tool',
        tool: 'bash',
        callID: 'SrGFNaykzHdFwXGi',
        state: {
          status: 'completed',
          input: { command: 'cat fact.txt', description: 'Reads the content of fact.txt' },
          output: 'the answer is 42\n',
          metadata: { output: 'the answer is 42\n', exit: 0, description: 'Reads the content of fact.txt', truncated: false },
          title: 'Reads the content of fact.txt',
          time: { start: 1, end: 2 },
        },
      },
    }))
    // session_id event fires first because this is the first event in this parser
    expect(r.events).toEqual([
      { type: 'session_id', externalId: 'ses_1' },
      {
        type: 'tool_use',
        id: 'SrGFNaykzHdFwXGi',
        name: 'bash',
        input: { command: 'cat fact.txt', description: 'Reads the content of fact.txt' },
      },
      {
        type: 'tool_result',
        toolUseId: 'SrGFNaykzHdFwXGi',
        output: 'the answer is 42\n',
        isError: false,
      },
    ])
  })

  it('marks tool_result as error when bash metadata.exit is non-zero', () => {
    const p = opencodeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({
      type: 'tool_use',
      timestamp: 1,
      sessionID: 'ses_1',
      part: {
        type: 'tool',
        tool: 'bash',
        callID: 'call_err',
        state: {
          status: 'completed',
          input: { command: 'false' },
          output: '',
          metadata: { exit: 1 },
        },
        id: 'prt', messageID: 'msg', sessionID: 'ses_1',
      },
    }))
    const toolResult = r.events.find(e => e.type === 'tool_result')
    expect(toolResult).toBeDefined()
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.isError).toBe(true)
    }
  })

  it('coerces non-string tool output to a JSON string', () => {
    const p = opencodeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({
      type: 'tool_use',
      timestamp: 1,
      sessionID: 'ses_1',
      part: {
        type: 'tool',
        tool: 'read',
        callID: 'call_obj',
        state: {
          status: 'completed',
          input: { path: '/tmp/x.json' },
          output: { name: 'foo', value: 42 },
          metadata: {},
        },
        id: 'prt', messageID: 'msg', sessionID: 'ses_1',
      },
    }))
    const toolResult = r.events.find(e => e.type === 'tool_result')
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.output).toBe('{"name":"foo","value":42}')
    }
  })

  it('emits result_done on step_finish(reason=stop) with the externalId', () => {
    const p = opencodeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({
      type: 'step_finish',
      timestamp: 1,
      sessionID: 'ses_done',
      part: {
        id: 'prt_finish',
        messageID: 'msg_1',
        sessionID: 'ses_done',
        type: 'step-finish',
        reason: 'stop',
        tokens: { total: 100, input: 90, output: 10, reasoning: 0, cache: { write: 0, read: 0 } },
        cost: 0.001,
      },
    }))
    const done = r.events.find(e => e.type === 'result_done')
    expect(done).toEqual({ type: 'result_done', externalId: 'ses_done' })
  })

  it('does NOT emit result_done on step_finish(reason=tool-calls) — that step is intermediate', () => {
    const p = opencodeAdapter.createParser(baseOpts)
    p.parseLine(JSON.stringify({ type: 'step_start', sessionID: 'ses_1', timestamp: 0, part: { id: 'p', messageID: 'm', sessionID: 'ses_1', type: 'step-start' } })) // prime session_id
    const r = p.parseLine(JSON.stringify({
      type: 'step_finish',
      timestamp: 1,
      sessionID: 'ses_1',
      part: { type: 'step-finish', reason: 'tool-calls', id: 'p', messageID: 'm', sessionID: 'ses_1' },
    }))
    expect(r.events.find(e => e.type === 'result_done')).toBeUndefined()
  })

  it('emits result_error on error event with classified code', () => {
    const p = opencodeAdapter.createParser({ ...baseOpts, resumeId: 'ses_old' })
    const r = p.parseLine(JSON.stringify({
      type: 'error',
      timestamp: 1,
      sessionID: 'ses_old',
      error: {
        name: 'ProviderAuthError',
        data: {
          providerID: 'google',
          message: "Google Generative AI API key is missing.",
        },
      },
    }))
    const err = r.events.find(e => e.type === 'result_error')
    expect(err).toBeDefined()
    if (err?.type === 'result_error') {
      // Auth-missing isn't a session/context issue → process_error
      expect(err.code).toBe('process_error')
      expect(err.errorText).toContain('API key is missing')
    }
  })

  it('classifies result_error as provider_quota for quota / 429 phrasing', () => {
    const p = opencodeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({
      type: 'error',
      timestamp: 1,
      sessionID: 'ses_1',
      error: {
        name: 'ProviderError',
        data: { message: 'You exceeded your current quota, please check your plan and billing details.' },
      },
    }))
    const err = r.events.find(e => e.type === 'result_error')
    expect(err).toBeDefined()
    if (err?.type === 'result_error') {
      expect(err.code).toBe('provider_quota')
      expect(err.message).toContain('rate limit or quota was reached')
    }
  })

  it('returns rawChunk=null for unparseable lines', () => {
    const p = opencodeAdapter.createParser(baseOpts)
    expect(p.parseLine('').rawChunk).toBeNull()
    expect(p.parseLine('not json').rawChunk).toBeNull()
    expect(p.parseLine('   ').rawChunk).toBeNull()
  })

  it('returns rawChunk for parseable but unhandled chunks', () => {
    const p = opencodeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({ type: 'unknown_future_event', sessionID: 'ses_1' }))
    expect(r.rawChunk).toEqual({ type: 'unknown_future_event', sessionID: 'ses_1' })
    // Unknown event types still emit session_id once if sessionID present
    expect(r.events).toEqual([{ type: 'session_id', externalId: 'ses_1' }])
  })
})

describe('opencodeAdapter.buildArgs', () => {
  it('appends --dir <resolved path> when workingDirectory is set (locks opencode project root to steward cwd)', () => {
    const args = opencodeAdapter.buildArgs({ ...baseOpts, workingDirectory: '/tmp/myrepo' })
    const i = args.indexOf('--dir')
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toMatch(/myrepo$/)
  })

  it('does not add --dir when workingDirectory is unset', () => {
    const args = opencodeAdapter.buildArgs(baseOpts)
    expect(args).not.toContain('--dir')
  })

  it('emits the run-mode baseline flags (run, --format json, --dangerously-skip-permissions)', () => {
    const args = opencodeAdapter.buildArgs(baseOpts)
    expect(args[0]).toBe('run')
    expect(args).toContain('--format')
    expect(args).toContain('json')
    expect(args).toContain('--dangerously-skip-permissions')
  })

  it('appends --model when set', () => {
    const args = opencodeAdapter.buildArgs({ ...baseOpts, model: 'google/gemini-2.5-flash' })
    expect(args).toContain('--model')
    expect(args).toContain('google/gemini-2.5-flash')
  })

  it('appends -s <session-id> when resumeId is set', () => {
    expect(opencodeAdapter.buildArgs(baseOpts)).not.toContain('-s')
    const args = opencodeAdapter.buildArgs({ ...baseOpts, resumeId: 'ses_xyz' })
    expect(args).toContain('-s')
    expect(args).toContain('ses_xyz')
  })

  it('prepends systemPrompt to the user message with a separator', () => {
    const args = opencodeAdapter.buildArgs({ ...baseOpts, prompt: 'do thing', systemPrompt: 'you are helpful' })
    // last arg is the prompt (after `--`)
    const idx = args.indexOf('--')
    expect(idx).toBeGreaterThan(-1)
    const prompt = args[idx + 1]
    expect(prompt).toContain('you are helpful')
    expect(prompt).toContain('do thing')
    expect(prompt).toContain('---')
  })

  it('passes the bare prompt after `--` when no systemPrompt', () => {
    const args = opencodeAdapter.buildArgs({ ...baseOpts, prompt: 'hello' })
    const idx = args.indexOf('--')
    expect(args[idx + 1]).toBe('hello')
  })
})

describe('opencodeAdapter.buildEnv', () => {
  it('strips CLAUDECODE proactively (defensive vs accidental sub-agent behavior)', () => {
    const env = { CLAUDECODE: '1', GOOGLE_GENERATIVE_AI_API_KEY: 'k', PATH: '/usr/bin' }
    const out = opencodeAdapter.buildEnv(env)
    expect(out.CLAUDECODE).toBeUndefined()
    expect(out.GOOGLE_GENERATIVE_AI_API_KEY).toBe('k')
    expect(out.PATH).toBe('/usr/bin')
  })

  it('passes through provider keys unchanged (opencode reads them directly)', () => {
    const env = {
      GOOGLE_GENERATIVE_AI_API_KEY: 'g',
      ANTHROPIC_API_KEY: 'a',
      GEMINI_API_KEY: 'gem',
    }
    const out = opencodeAdapter.buildEnv(env)
    expect(out.GOOGLE_GENERATIVE_AI_API_KEY).toBe('g')
    expect(out.ANTHROPIC_API_KEY).toBe('a')
    expect(out.GEMINI_API_KEY).toBe('gem')
  })

  it('defaults OPENCODE_ENABLE_EXA to "1" so the websearch tool is gated in', () => {
    const out = opencodeAdapter.buildEnv({ PATH: '/usr/bin' })
    expect(out.OPENCODE_ENABLE_EXA).toBe('1')
  })

  it('respects an explicit OPENCODE_ENABLE_EXA value (deployment override)', () => {
    expect(opencodeAdapter.buildEnv({ OPENCODE_ENABLE_EXA: 'true' }).OPENCODE_ENABLE_EXA).toBe('true')
    // Empty string = deployment opt-out; opencode reads it as falsy.
    expect(opencodeAdapter.buildEnv({ OPENCODE_ENABLE_EXA: '' }).OPENCODE_ENABLE_EXA).toBe('')
  })

  it('passes EXA_API_KEY through unchanged (opencode/Exa reads it directly)', () => {
    const out = opencodeAdapter.buildEnv({ EXA_API_KEY: 'sk-test' })
    expect(out.EXA_API_KEY).toBe('sk-test')
  })
})

describe('opencodeAdapter.classifyError', () => {
  it('maps context-window errors to context_limit', () => {
    expect(opencodeAdapter.classifyError('context window exceeded', false)).toBe('context_limit')
    expect(opencodeAdapter.classifyError('token limit reached', false)).toBe('context_limit')
  })

  it('maps rate-limit / 429 to provider_quota (not session_expired)', () => {
    expect(opencodeAdapter.classifyError('rate limit exceeded', true)).toBe('provider_quota')
    expect(opencodeAdapter.classifyError('HTTP 429', true)).toBe('provider_quota')
  })

  it('maps session-not-found phrasing to session_expired when a resume was attempted', () => {
    expect(opencodeAdapter.classifyError('session not found', true)).toBe('session_expired')
  })

  it('routes ProviderModelNotFoundError to process_error, NOT session_expired', () => {
    // Regression: the error name contains "not found" — earlier versions
    // matched the bare 'not found' substring and tagged this session_expired,
    // bricking the chat UI with the "previous session could not be resumed"
    // banner when the real fix is to pick a different model.
    expect(opencodeAdapter.classifyError(
      'ProviderModelNotFoundError: ProviderModelNotFoundError',
      true,
    )).toBe('process_error')
    expect(opencodeAdapter.classifyError('model not found: gemma-x', true)).toBe('process_error')
    expect(opencodeAdapter.classifyError('Unknown model foo/bar', false)).toBe('process_error')
  })

  it('does NOT mis-tag arbitrary errors as session_expired just because hadResume=true', () => {
    // Regression for the same class of bug — `hadResume` alone is no longer
    // enough to declare the session dead.
    expect(opencodeAdapter.classifyError('Some unexpected error', true)).toBe('process_error')
    expect(opencodeAdapter.classifyError('network unreachable', true)).toBe('process_error')
    // Bare "not found" without "session" / "model" / "conversation" context
    // should NOT trip session_expired either.
    expect(opencodeAdapter.classifyError('Tool foo not found', true)).toBe('process_error')
  })

  it('falls through to process_error for unknown messages without resume', () => {
    expect(opencodeAdapter.classifyError('unspecified provider failure', false)).toBe('process_error')
  })
})

describe('opencodeAdapter.capabilities', () => {
  it('declares no token streaming, structured tool use, MCP via config, and branch resume', () => {
    expect(opencodeAdapter.capabilities).toEqual({
      streamingTokens: false,
      toolUseStructured: true,
      supportsMcp: true,
      branchResume: true,
    })
  })
})
