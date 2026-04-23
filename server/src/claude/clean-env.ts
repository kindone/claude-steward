/**
 * Build a sanitized env for spawning the Claude CLI subprocess.
 *
 * Why this exists: when the steward server is itself running inside a
 * Claude-managed process (or when env vars leak in from the shell), the
 * spawned CLI child can inherit `CLAUDECODE=1` and sibling vars that make
 * it think it's a sub-agent. It then hangs forever waiting for IPC from a
 * "parent session" that doesn't exist. We strip the whole `CLAUDE*` family
 * to prevent that.
 *
 * We also strip `ANTHROPIC_API_KEY` so the CLI auths via `~/.claude/`
 * (OAuth) instead of API credits. API credits break on rate limits and
 * don't carry subscription features; an accidentally-set key would
 * silently downgrade every spawn.
 *
 * ## Stripped
 * - All `CLAUDE*` env vars (session/IPC state)
 * - `ANTHROPIC_API_KEY`
 *
 * ## Preserved (explicit allowlist)
 * - `ANTHROPIC_BASE_URL` — endpoint override (self-hosted / proxy setups)
 * - `CLAUDE_CODE_OAUTH_TOKEN` — long-lived headless-auth token from
 *   `claude setup-token`. Non-rotating, used for containerized / CI auth
 *   where the rotating `~/.claude/.credentials.json` pair would race with
 *   the host CLI.
 *
 * The caller is still responsible for adding `CI=true` at spawn time to
 * suppress the CLI's TTY detection in stream-json output mode.
 *
 * @param env  Source env (typically `process.env`). Passed explicitly so
 *             callers in tests can supply a fixture without monkey-patching
 *             the global.
 */
export function buildCleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const STRIP = new Set(['ANTHROPIC_API_KEY'])
  const out: NodeJS.ProcessEnv = {}
  for (const [key, val] of Object.entries(env)) {
    if (val === undefined) continue
    if (key.startsWith('CLAUDE')) continue
    if (STRIP.has(key)) continue
    out[key] = val
  }
  // Re-admit the allowlisted CLAUDE_* var. ANTHROPIC_BASE_URL passes through
  // the main loop naturally since it doesn't match any strip criteria.
  if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    out.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN
  }
  return out
}
