// Feature:     CliAdapter abstraction (Claude implementation)
// Arch/Design: claudeAdapter concentrates Claude-specific knowledge — args,
//              env, parser, error classification — so other CLIs (cline) can
//              be added without touching spawn lifecycle in the workers.
// Spec:        Parser:
//                ∀ system/init line: emits exactly one session_id event the
//                  first time it sees one, none thereafter (idempotent).
//                ∀ stream_event content_block_delta(text_delta): emits a
//                  text_delta event with the delta text.
//                ∀ stream_event content_block_start(text): emits text_block_start.
//                ∀ assistant tool_use blocks: emits tool_use with id/name/input.
//                ∀ user tool_result blocks: emits tool_result with normalized
//                  string output (handles array-of-text-blocks shape).
//                ∀ result(is_error=true): emits result_error with classified code
//                  and friendly message; preserves errorText for logging.
//                ∀ result(is_error=false): emits result_done with externalId.
//                Unparseable lines → no events, rawChunk=null.
//              Args:
//                Always include --print, --output-format stream-json, --verbose,
//                  --include-partial-messages.
//                resumeId set → --resume <id>; null → no --resume.
//                permissionMode='default' → no --permission-mode flag (Claude
//                  default; spawning with 'default' would stall on interactive
//                  prompts in non-TTY mode).
//                mcpConfigPath set → --mcp-config + --disallowed-tools blocking
//                  CronCreate/CronDelete (harness-only schedule tools).
//              ErrorClassify:
//                Context phrases → context_limit; resume in flight or session
//                  keywords (no overload) → session_expired; otherwise process_error.
// @quality:    correctness, refactor-safety
// @type:       example
// @mode:       verification

import { describe, it, expect } from 'vitest'
import { claudeAdapter } from '../../cli/claude-adapter.js'
import type { LaunchOptions } from '../../cli/types.js'

const baseOpts: LaunchOptions = {
  prompt: 'hello',
  resumeId: null,
  systemPrompt: null,
  permissionMode: null,
  model: null,
  mcpConfigPath: null,
}

describe('claudeAdapter.createParser', () => {
  it('emits session_id once, then never again', () => {
    const p = claudeAdapter.createParser(baseOpts)
    const first = p.parseLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc-123' }))
    const second = p.parseLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'should-not-emit' }))
    expect(first.events).toEqual([{ type: 'session_id', externalId: 'abc-123' }])
    expect(second.events).toEqual([])
  })

  it('extracts text_delta from stream_event content_block_delta', () => {
    const p = claudeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello world' } },
    }))
    expect(r.events).toEqual([{ type: 'text_delta', text: 'hello world' }])
  })

  it('extracts text_block_start from content_block_start of type text', () => {
    const p = claudeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', content_block: { type: 'text' } },
    }))
    expect(r.events).toEqual([{ type: 'text_block_start' }])
  })

  it('does not emit text_block_start for non-text content blocks', () => {
    const p = claudeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', content_block: { type: 'tool_use' } },
    }))
    expect(r.events).toEqual([])
  })

  it('extracts tool_use blocks from assistant chunk', () => {
    const p = claudeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({
      type: 'assistant',
      message: { content: [
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/etc/hosts' } },
        { type: 'text', text: 'reading file…' },
      ] },
    }))
    expect(r.events).toEqual([
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/etc/hosts' } },
    ])
  })

  it('normalizes tool_result content from array-of-text-blocks shape', () => {
    const p = claudeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({
      type: 'user',
      message: { content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: [
            { type: 'text', text: 'line one' },
            { type: 'text', text: 'line two' },
          ],
          is_error: false,
        },
      ] },
    }))
    expect(r.events).toEqual([
      { type: 'tool_result', toolUseId: 'tool-1', output: 'line one\nline two', isError: false },
    ])
  })

  it('preserves string tool_result content unchanged', () => {
    const p = claudeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({
      type: 'user',
      message: { content: [
        { type: 'tool_result', tool_use_id: 'tool-2', content: 'plain string output', is_error: true },
      ] },
    }))
    expect(r.events).toEqual([
      { type: 'tool_result', toolUseId: 'tool-2', output: 'plain string output', isError: true },
    ])
  })

  it('emits result_done on success with externalId', () => {
    const p = claudeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: 'final-session',
      is_error: false,
      result: 'done',
    }))
    expect(r.events).toEqual([{ type: 'result_done', externalId: 'final-session' }])
  })

  it('classifies result_error as session_expired when resumeId is set', () => {
    const p = claudeAdapter.createParser({ ...baseOpts, resumeId: 'prior-session' })
    const r = p.parseLine(JSON.stringify({
      type: 'result',
      subtype: 'error',
      session_id: '',
      is_error: true,
      errors: ['No conversation found with session ID prior-session'],
      result: '',
    }))
    expect(r.events.length).toBe(1)
    const ev = r.events[0]
    expect(ev.type).toBe('result_error')
    if (ev.type === 'result_error') {
      expect(ev.code).toBe('session_expired')
      expect(ev.message).toContain('previous session could not be resumed')
      expect(ev.errorText).toContain('No conversation found')
    }
  })

  it('classifies result_error as context_limit on token-limit phrasing', () => {
    const p = claudeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({
      type: 'result',
      subtype: 'error',
      session_id: '',
      is_error: true,
      errors: ['context window exceeded; conversation too long'],
      result: '',
    }))
    expect(r.events.length).toBe(1)
    const ev = r.events[0]
    if (ev.type === 'result_error') {
      expect(ev.code).toBe('context_limit')
      expect(ev.message).toContain('Context limit reached')
    }
  })

  it('classifies generic errors as process_error', () => {
    const p = claudeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({
      type: 'result',
      subtype: 'error',
      session_id: '',
      is_error: true,
      errors: ['network unreachable'],
      result: '',
    }))
    const ev = r.events[0]
    if (ev.type === 'result_error') {
      expect(ev.code).toBe('process_error')
    }
  })

  it('returns rawChunk=null for unparseable lines', () => {
    const p = claudeAdapter.createParser(baseOpts)
    expect(p.parseLine('').rawChunk).toBeNull()
    expect(p.parseLine('not json {').rawChunk).toBeNull()
    expect(p.parseLine('   ').rawChunk).toBeNull()
  })

  it('returns rawChunk for parseable lines even when no events fire', () => {
    const p = claudeAdapter.createParser(baseOpts)
    const r = p.parseLine(JSON.stringify({ type: 'message_start' }))
    expect(r.rawChunk).toEqual({ type: 'message_start' })
    expect(r.events).toEqual([])
  })
})

describe('claudeAdapter.buildArgs', () => {
  it('emits the streaming-chat baseline flags', () => {
    const args = claudeAdapter.buildArgs(baseOpts)
    expect(args).toContain('--print')
    expect(args).toContain('--output-format')
    expect(args).toContain('stream-json')
    expect(args).toContain('--verbose')
    expect(args).toContain('--include-partial-messages')
    expect(args).toContain('hello') // prompt
  })

  it('appends --resume only when resumeId is set', () => {
    expect(claudeAdapter.buildArgs(baseOpts)).not.toContain('--resume')
    const withResume = claudeAdapter.buildArgs({ ...baseOpts, resumeId: 'abc' })
    expect(withResume).toContain('--resume')
    expect(withResume).toContain('abc')
  })

  it("skips --permission-mode when mode is 'default' (else it stalls in non-TTY)", () => {
    const args = claudeAdapter.buildArgs({ ...baseOpts, permissionMode: 'default' })
    expect(args).not.toContain('--permission-mode')
  })

  it('passes non-default permission modes through', () => {
    const args = claudeAdapter.buildArgs({ ...baseOpts, permissionMode: 'plan' })
    expect(args).toContain('--permission-mode')
    expect(args).toContain('plan')
  })

  it('wires MCP and disallows harness cron tools when mcpConfigPath is set', () => {
    const args = claudeAdapter.buildArgs({ ...baseOpts, mcpConfigPath: '/tmp/mcp.json' })
    expect(args).toContain('--mcp-config')
    expect(args).toContain('/tmp/mcp.json')
    expect(args).toContain('--disallowed-tools')
    expect(args).toContain('CronCreate,CronDelete')
  })

  it('omits MCP flags when mcpConfigPath is null', () => {
    const args = claudeAdapter.buildArgs(baseOpts)
    expect(args).not.toContain('--mcp-config')
    expect(args).not.toContain('--disallowed-tools')
  })
})

describe('claudeAdapter.classifyError', () => {
  it('detects context_limit ahead of session_expired', () => {
    expect(claudeAdapter.classifyError('context window too long', true)).toBe('context_limit')
  })

  it('returns session_expired when a resume was in flight and not an overload', () => {
    expect(claudeAdapter.classifyError('No conversation found', true)).toBe('session_expired')
  })

  it('treats 529 / overload as provider_quota even when resume was in flight', () => {
    expect(claudeAdapter.classifyError('Anthropic 529 overload', true)).toBe('provider_quota')
  })

  it('returns process_error for unknown messages without a resume', () => {
    expect(claudeAdapter.classifyError('network unreachable', false)).toBe('process_error')
  })
})

describe('claudeAdapter.capabilities', () => {
  it('declares streamingTokens, structured tool use, MCP, and branch resume', () => {
    expect(claudeAdapter.capabilities).toEqual({
      streamingTokens: true,
      toolUseStructured: true,
      supportsMcp: true,
      branchResume: true,
    })
  })
})
