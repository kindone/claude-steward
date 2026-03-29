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
}

const SCHEDULE_BLOCK_RE = /<schedule>([\s\S]*?)<\/schedule>/g

/**
 * Extract all valid <schedule> blocks from text.
 * Returns the parsed schedules and the text with all blocks stripped.
 */
export function extractScheduleBlocks(text: string): {
  schedules: ParsedSchedule[]
  strippedText: string
} {
  const schedules: ParsedSchedule[] = []

  const strippedText = text.replace(SCHEDULE_BLOCK_RE, (_, json: string) => {
    try {
      const parsed = JSON.parse(json.trim()) as Record<string, unknown>
      const cronExpr = typeof parsed.cron === 'string' ? parsed.cron.trim() : ''
      const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
      const label = typeof parsed.label === 'string' ? parsed.label.trim() : prompt.slice(0, 60)

      if (!cronExpr || !prompt) return ''
      if (!cron.validate(cronExpr)) return ''

      schedules.push({ cron: cronExpr, prompt, label })
    } catch {
      // Malformed JSON — strip the block silently
    }
    return ''
  }).trim()

  return { schedules, strippedText }
}
