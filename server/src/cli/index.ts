/**
 * CliAdapter selection.
 *
 * Pick the active adapter via the `STEWARD_CLI` env var. Defaults to
 * `claude` so existing Claude-only deployments behave identically after
 * the multi-CLI refactor.
 *
 *   STEWARD_CLI=claude     # default — Anthropic claude CLI
 *   STEWARD_CLI=opencode   # opencode (Go binary, embedding-first; in progress)
 *
 * Cline was investigated as a candidate but rejected — its per-invocation
 * runtime cost (~200-300 MB plus heavy startup I/O) doesn't fit steward's
 * spawn-per-turn model on small instances. The CliAdapter abstraction
 * remains; opencode replaces cline as the second supported CLI.
 *
 * Resolution is lazy via {@link getAdapter} so test setups that override
 * `process.env.STEWARD_CLI` after import still take effect.
 */

import { claudeAdapter } from './claude-adapter.js'
import { opencodeAdapter } from './opencode-adapter.js'
import type { CliAdapter } from './types.js'

export type AdapterName = 'claude' | 'opencode'

/** Return the singleton adapter for `name`, or for `process.env.STEWARD_CLI`. */
export function getAdapter(name?: AdapterName): CliAdapter {
  const requested = (name ?? (process.env.STEWARD_CLI as AdapterName | undefined) ?? 'claude') as AdapterName
  switch (requested) {
    case 'claude':
      return claudeAdapter
    case 'opencode':
      return opencodeAdapter
    default:
      throw new Error(`unknown CLI adapter: ${String(requested)}`)
  }
}

export type { CliAdapter, CliParser, CanonicalEvent, LaunchOptions, ErrorCode, CliCapabilities } from './types.js'
