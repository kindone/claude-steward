// Feature:     Scheduler — system prompt injection for schedule awareness
// Arch/Design: buildScheduleFragment and buildEffectiveSystemPrompt are pure functions
//              (modulo Date.now() for current UTC time); they inject MCP tool descriptions
//              and timezone context into Claude's system prompt
// Spec:        ∀ session: buildScheduleFragment always returns a non-empty string
//              ∀ session: fragment contains "cron" and "UTC" keywords
//              ∀ session: fragment contains MCP tool names (schedule_create etc.)
//              ∀ session: fragment forbids <schedule> blocks and CronCreate/CronDelete
//              ∀ session with timezone: fragment contains the timezone string
//              ∀ session without timezone: fragment contains a prompt to ask for timezone
//              ∀ session: buildEffectiveSystemPrompt returns fragment + session.system_prompt
//              ∀ session with null system_prompt: result equals fragment alone
// @quality:    correctness
// @type:       example
// @mode:       verification

import { describe, it, expect } from 'vitest'
import { buildScheduleFragment, buildEffectiveSystemPrompt } from '../../lib/schedulePrompt.js'
import type { Session } from '../../db/index.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-session-id',
    title: 'Test Session',
    project_id: 'test-project-id',
    system_prompt: null,
    permission_mode: 'acceptEdits',
    claude_session_id: null,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    timezone: null,
    model: null,
    compacted_from: null,
    ...overrides,
  }
}

// ── buildScheduleFragment ─────────────────────────────────────────────────────

describe('buildScheduleFragment', () => {

  it('always returns a non-empty string', () => {
    const result = buildScheduleFragment(makeSession())
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('always contains "cron" keyword', () => {
    expect(buildScheduleFragment(makeSession())).toContain('cron')
  })

  it('always contains the session_id so Claude does not need to query the DB', () => {
    const session = makeSession({ id: 'test-session-id' })
    expect(buildScheduleFragment(session)).toContain('test-session-id')
  })

  it('always contains "UTC" keyword', () => {
    expect(buildScheduleFragment(makeSession())).toContain('UTC')
  })

  it('contains MCP tool names', () => {
    const result = buildScheduleFragment(makeSession())
    expect(result).toContain('schedule_create')
    expect(result).toContain('schedule_list')
    expect(result).toContain('schedule_update')
    expect(result).toContain('schedule_delete')
  })

  it('forbids <schedule> text blocks', () => {
    const result = buildScheduleFragment(makeSession())
    // The fragment should tell Claude NOT to emit <schedule> blocks
    expect(result).toContain('never emit')
  })

  it('forbids CronCreate and CronDelete', () => {
    const result = buildScheduleFragment(makeSession())
    expect(result).toContain('CronCreate')
    expect(result).toContain('CronDelete')
    // Must be in a "never call" context, not just mentioned
    expect(result).toContain('never call CronCreate')
  })

  it('always contains "once" keyword (explains one-shot flag)', () => {
    expect(buildScheduleFragment(makeSession())).toContain('once')
  })

  it('always contains cron limitations guidance', () => {
    const result = buildScheduleFragment(makeSession())
    expect(result).toContain('biweekly')
    expect(result).toContain('last day of month')
    expect(result).toContain('except')
  })

  it('includes timezone when session.timezone is set', () => {
    const session = makeSession({ timezone: 'America/New_York' })
    const result = buildScheduleFragment(session)
    expect(result).toContain('America/New_York')
  })

  it('includes different timezones correctly', () => {
    const timezones = ['Asia/Seoul', 'Europe/London', 'Australia/Sydney', 'UTC']
    for (const tz of timezones) {
      const result = buildScheduleFragment(makeSession({ timezone: tz }))
      expect(result).toContain(tz)
    }
  })

  it('asks user to confirm timezone when session.timezone is null', () => {
    const result = buildScheduleFragment(makeSession({ timezone: null }))
    // Should prompt the user to share their timezone
    expect(result.toLowerCase()).toMatch(/timezone|time zone/)
    // Should NOT contain a specific timezone name
    expect(result).not.toContain('America/')
    expect(result).not.toContain('Asia/')
    expect(result).not.toContain('Europe/')
  })

  it('current UTC time appears in output (ISO-ish format)', () => {
    const result = buildScheduleFragment(makeSession())
    // The current year should appear in the fragment
    expect(result).toContain(new Date().getUTCFullYear().toString())
    // The UTC suffix should appear
    expect(result).toContain('UTC')
    // The fragment should have a time in HH:MM format (colon)
    expect(result).toMatch(/\d{2}:\d{2}/)
  })

})

// ── buildEffectiveSystemPrompt ────────────────────────────────────────────────

describe('buildEffectiveSystemPrompt', () => {

  it('returns fragment alone when session has no system_prompt', () => {
    const session = makeSession({ system_prompt: null })
    const fragment = buildScheduleFragment(session)
    const result = buildEffectiveSystemPrompt(session)
    // Should equal the fragment (both are computed fresh, so compare structure)
    expect(result).toContain('cron')
    expect(result).toContain('UTC')
    // Should NOT contain anything from a null system prompt
    expect(result).toBe(fragment)
  })

  it('prepends session system_prompt before fragment when set', () => {
    const session = makeSession({ system_prompt: 'You are a helpful assistant.' })
    const result = buildEffectiveSystemPrompt(session)
    expect(result).not.toBeNull()
    expect(result!).toContain('You are a helpful assistant.')
    expect(result!).toContain('cron')
    // system_prompt comes before the fragment
    const promptIdx = result!.indexOf('You are a helpful assistant.')
    const cronIdx = result!.indexOf('cron')
    expect(promptIdx).toBeLessThan(cronIdx)
  })

  it('result is never null (always at least the fragment)', () => {
    const sessions = [
      makeSession(),
      makeSession({ system_prompt: 'Custom prompt' }),
      makeSession({ timezone: 'Asia/Seoul' }),
      makeSession({ system_prompt: 'Custom', timezone: 'Europe/Paris' }),
    ]
    for (const session of sessions) {
      const result = buildEffectiveSystemPrompt(session)
      expect(result).not.toBeNull()
      expect(result!.length).toBeGreaterThan(0)
    }
  })

  it('timezone is included in result regardless of system_prompt presence', () => {
    const tz = 'Asia/Tokyo'
    const withPrompt = makeSession({ system_prompt: 'Help me.', timezone: tz })
    const withoutPrompt = makeSession({ timezone: tz })
    expect(buildEffectiveSystemPrompt(withPrompt)).toContain(tz)
    expect(buildEffectiveSystemPrompt(withoutPrompt)).toContain(tz)
  })

})
