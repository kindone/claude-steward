#!/bin/bash
set -e

# ── Claude auth ────────────────────────────────────────────────────────────────
# Authentication is done via CLAUDE_CODE_OAUTH_TOKEN (long-lived token from
# `claude setup-token`, set in docker-compose.yml from the host's .env).
# No credential files are mounted — the token is self-contained and does not
# rotate, so the container cannot interfere with any other account's session.

if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  echo "[entrypoint] WARNING: CLAUDE_CODE_OAUTH_TOKEN is not set — Claude CLI will not be authenticated"
  echo "[entrypoint]          run 'CLAUDE_CONFIG_DIR=\$HOME/.claude-test claude setup-token' on the host"
  echo "[entrypoint]          and add STEWARD_TEST_OAUTH_TOKEN=<token> to your .env"
fi

# Claude CLI still needs a writable config dir for session state, logs, etc.
mkdir -p /root/.claude/projects

# syncClaudeSettings() in server/src/mcp/config.ts writes MCP server
# registrations to ~/.claude.json — but silently skips if the file doesn't
# exist. Bootstrap an empty object so the sync step populates it on startup.
if [ ! -f /root/.claude.json ]; then
  echo "[entrypoint] bootstrapping empty /root/.claude.json for MCP sync"
  echo '{}' > /root/.claude.json
fi

# ── Ensure ANTHROPIC_API_KEY is NOT set ───────────────────────────────────────
# If present it routes Claude CLI through API credits instead of the plan.
unset ANTHROPIC_API_KEY

# ── Database ───────────────────────────────────────────────────────────────────
export DATABASE_PATH="${DATABASE_PATH:-/data/steward.db}"

# ── .env (optional) ───────────────────────────────────────────────────────────
# Mount a .env file at /app/.env if you need APP_DOMAIN, VAPID_*, etc.
# dotenv reads it at startup; nothing to do here.

# ── Start PM2 ──────────────────────────────────────────────────────────────────
echo "[entrypoint] starting PM2 runtime…"
exec pm2-runtime ecosystem.config.cjs
