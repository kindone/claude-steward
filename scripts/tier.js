#!/usr/bin/env node
// Granular tier management for Steward PM2 processes.
// Usage: node scripts/tier.js <action> <tier> [--force]
//   action: restart | down | logs
//   tier:   prod | dev | safe | all
//
// Bulk (all) restart/down requires --force to prevent accidents.
// 'safe' is never included in bulk operations.

import { execSync } from 'node:child_process'

const RESET  = '\x1b[0m'
const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const BOLD   = '\x1b[1m'
const DIM    = '\x1b[2m'

const TIERS = {
  prod: ['steward-main', 'steward-worker'],
  dev:  ['steward-server', 'steward-client', 'steward-worker'],
  safe: ['steward-safe'],
}

const [action, tier, flag] = process.argv.slice(2)
const force = flag === '--force'

const VALID_ACTIONS = ['restart', 'down', 'logs']
const VALID_TIERS   = ['prod', 'dev', 'safe', 'all']

if (!VALID_ACTIONS.includes(action) || !VALID_TIERS.includes(tier)) {
  console.error(`${RED}Usage: node scripts/tier.js <${VALID_ACTIONS.join('|')}> <${VALID_TIERS.join('|')}> [--force]${RESET}`)
  process.exit(1)
}

// Bulk operations require --force; safe is never included in bulk.
if (tier === 'all') {
  if (!force) {
    console.error(
      `\n${YELLOW}${BOLD}Warning:${RESET}${YELLOW} '${action} all' affects prod + dev (safe is never touched).${RESET}\n` +
      `Re-run with ${BOLD}--force${RESET} to confirm:\n` +
      `  ${DIM}node scripts/tier.js ${action} all --force${RESET}\n`
    )
    process.exit(1)
  }
  // Combine prod + dev, dedup (worker appears in both).
  const procs = [...new Set([...TIERS.prod, ...TIERS.dev])]
  run(action, procs)
} else {
  run(action, TIERS[tier])
}

function run(action, procs) {
  const list = procs.join(' ')
  try {
    if (action === 'restart') {
      console.log(`\n${BOLD}Restarting:${RESET} ${list}\n`)
      execSync(`pm2 restart ${list} --update-env`, { stdio: 'inherit' })
      console.log(`\n${GREEN}${BOLD}Done.${RESET}\n`)
    } else if (action === 'down') {
      console.log(`\n${BOLD}Stopping:${RESET} ${list}\n`)
      execSync(`pm2 delete ${list}`, { stdio: 'inherit' })
      console.log(`\n${GREEN}${BOLD}Done.${RESET}\n`)
    } else if (action === 'logs') {
      execSync(`pm2 logs ${list}`, { stdio: 'inherit' })
    }
  } catch {
    if (action === 'down' || action === 'restart') {
      // pm2 exits non-zero when a process isn't found — not a fatal error for stop/restart.
      console.warn(`\n${YELLOW}One or more processes were not found (may not be running). Others were affected.${RESET}\n`)
    } else {
      console.error(`\n${RED}Command failed.${RESET}\n`)
      process.exit(1)
    }
  }
}
