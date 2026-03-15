import { Router } from 'express'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'
import { credentialQueries } from '../db/index.js'
import { getWebAuthnConfig, storeChallenge, consumeChallenge } from '../auth/webauthn.js'
import { createSessionCookie, clearSessionCookie, getValidSessionToken } from '../auth/session.js'

const router = Router()

// ── Status ────────────────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  const token = getValidSessionToken(req.cookies ?? {})
  const hasCredentials = credentialQueries.list().length > 0
  res.json({ authenticated: !!token, hasCredentials })
})

// ── Registration ──────────────────────────────────────────────────────────────

router.post('/register/start', async (req, res) => {
  const { rpID, rpName } = getWebAuthnConfig()
  const existing = credentialQueries.list()

  // If credentials already exist, only allow registration from an authenticated session.
  if (existing.length > 0) {
    const token = getValidSessionToken(req.cookies ?? {})
    if (!token) {
      res.status(401).json({ error: 'Already registered — authenticate first to add another device' })
      return
    }
  }

  const excludeCredentials = existing.map((c) => ({
    id: c.id,
    transports: c.transports
      ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[])
      : undefined,
  }))

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: 'owner',
    userDisplayName: 'Owner',
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  storeChallenge('registration', options.challenge)
  res.json(options)
})

router.post('/register/finish', async (req, res) => {
  const { rpID, expectedOrigins } = getWebAuthnConfig()
  const challenge = consumeChallenge('registration')

  if (!challenge) {
    res.status(400).json({ error: 'No pending registration challenge — start registration first' })
    return
  }

  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
    })

    if (!verified || !registrationInfo) {
      res.status(400).json({ error: 'Registration verification failed' })
      return
    }

    const { credential } = registrationInfo
    credentialQueries.insert(
      credential.id,
      Buffer.from(credential.publicKey),
      credential.counter,
      credential.transports ? JSON.stringify(credential.transports) : null,
    )

    createSessionCookie(res)
    res.json({ verified: true })
  } catch (err) {
    console.error('[auth] register/finish error:', err)
    res.status(400).json({ error: String(err) })
  }
})

// ── Authentication ────────────────────────────────────────────────────────────

router.post('/login/start', async (req, res) => {
  const { rpID } = getWebAuthnConfig()
  const existing = credentialQueries.list()

  if (existing.length === 0) {
    res.status(400).json({ error: 'No passkeys registered — register first' })
    return
  }

  const allowCredentials = existing.map((c) => ({
    id: c.id,
    transports: c.transports
      ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[])
      : undefined,
  }))

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: 'preferred',
  })

  storeChallenge('authentication', options.challenge)
  res.json(options)
})

router.post('/login/finish', async (req, res) => {
  const { rpID, expectedOrigins } = getWebAuthnConfig()
  const challenge = consumeChallenge('authentication')

  if (!challenge) {
    res.status(400).json({ error: 'No pending authentication challenge — start login first' })
    return
  }

  const credentialId = req.body?.id as string | undefined
  if (!credentialId) {
    res.status(400).json({ error: 'Missing credential id' })
    return
  }

  const stored = credentialQueries.findById(credentialId)
  if (!stored) {
    res.status(400).json({ error: 'Unknown credential' })
    return
  }

  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
      credential: {
        id: stored.id,
        publicKey: new Uint8Array(stored.public_key),
        counter: stored.counter,
        transports: stored.transports
          ? (JSON.parse(stored.transports) as AuthenticatorTransportFuture[])
          : undefined,
      },
    })

    if (!verified) {
      res.status(400).json({ error: 'Authentication verification failed' })
      return
    }

    credentialQueries.updateCounter(stored.id, authenticationInfo.newCounter)
    createSessionCookie(res)
    res.json({ verified: true })
  } catch (err) {
    console.error('[auth] login/finish error:', err)
    res.status(400).json({ error: String(err) })
  }
})

// ── Logout ────────────────────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  const token = getValidSessionToken(req.cookies ?? {})
  if (token) clearSessionCookie(res, token)
  res.json({ ok: true })
})

export default router
