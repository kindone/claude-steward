/**
 * Parses and strips <schedule> blocks from Claude's response text.
 * Claude includes these to create scheduled tasks inline in conversation.
 *
 * Format: <schedule>{"cron": "...", "prompt": "...", "label": "..."}</schedule>
 */

import cron from 'node-cron'

export type ParsedSchedule = {
  cron: string
  prompt: string
  label: string
  once: boolean
}

const SCHEDULE_BLOCK_RE = /<schedule>([\s\S]*?)<\/schedule>/g
// Matches fenced code blocks (``` ... ```) and inline code (` ... `) to exclude them from parsing
const CODE_FENCE_RE = /```[\s\S]*?```|`[^`\n]+`/g

/**
 * Extract all valid <schedule> blocks from text.
 * Returns the parsed schedules and the text with all blocks stripped.
 * Blocks inside markdown code fences (``` or `) are ignored — they are
 * documentation examples, not real schedule requests.
 */
export function extractScheduleBlocks(text: string): {
  schedules: ParsedSchedule[]
  strippedText: string
} {
  // Pre-compute ranges of code blocks so we can skip matches inside them
  const codeRanges: Array<[number, number]> = []
  for (const m of text.matchAll(CODE_FENCE_RE)) {
    codeRanges.push([m.index, m.index + m[0].length])
  }

  const insideCode = (start: number, end: number): boolean =>
    codeRanges.some(([cs, ce]) => start >= cs && end <= ce)

  const schedules: ParsedSchedule[] = []

  // Replacer receives (fullMatch, captureGroup, matchOffset)
  const strippedText = text.replace(SCHEDULE_BLOCK_RE, (full, json: string, matchOffset: number) => {
    if (insideCode(matchOffset, matchOffset + full.length)) return full // leave code examples intact

    try {
      const parsed = JSON.parse(json.trim()) as Record<string, unknown>
      const cronExpr = typeof parsed.cron === 'string' ? parsed.cron.trim() : ''
      const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
      const label = typeof parsed.label === 'string' ? parsed.label.trim() : prompt.slice(0, 60)
      const once = parsed.once === true

      if (!cronExpr || !prompt) return ''
      if (!cron.validate(cronExpr)) return ''

      schedules.push({ cron: cronExpr, prompt, label, once })
    } catch {
      // Malformed JSON — strip the block silently
    }
    return ''
  }).trim()

  return { schedules, strippedText }
}
