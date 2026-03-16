/**
 * WebAuthn / Passkey configuration and challenge store.
 *
 * Challenges are kept in memory with a 5-minute TTL — short-lived enough that
 * storing them in the DB would add churn without benefit.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000

interface PendingChallenge {
  challenge: string
  expiresAt: number
}

// Single-user app: one pending challenge slot per operation type.
const pendingChallenges = new Map<'registration' | 'authentication', PendingChallenge>()

export function getWebAuthnConfig() {
  const domain = process.env.APP_DOMAIN ?? 'localhost'
  const rpID = domain
  const isLocalhost = domain === 'localhost'

  const expectedOrigins = isLocalhost
    ? ['http://localhost:5173', 'http://localhost:3001', 'http://localhost:3002']
    : [`https://${domain}`, `https://dev.${domain}`]

  return { rpID, rpName: 'Claude Steward', expectedOrigins }
}

export function storeChallenge(type: 'registration' | 'authentication', challenge: string) {
  pendingChallenges.set(type, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS })
}

/** Returns the challenge string and removes it (one-time use). */
export function consumeChallenge(type: 'registration' | 'authentication'): string | null {
  const entry = pendingChallenges.get(type)
  if (!entry) return null
  pendingChallenges.delete(type)
  if (Date.now() > entry.expiresAt) return null
  return entry.challenge
}
