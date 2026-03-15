import { randomBytes } from 'node:crypto'
import type { Response } from 'express'
import { authSessionQueries } from '../db/index.js'

const SESSION_COOKIE = 'sid'
const SESSION_TTL_DAYS = 30

function isSecure() {
  return !!process.env.APP_DOMAIN && process.env.APP_DOMAIN !== 'localhost'
}

export function createSessionCookie(res: Response): void {
  const token = randomBytes(32).toString('base64url')
  authSessionQueries.create(token)

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecure(),
    sameSite: 'strict',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  })
}

export function clearSessionCookie(res: Response, token: string): void {
  authSessionQueries.delete(token)
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: isSecure(), sameSite: 'strict', path: '/' })
}

/** Returns the session token if the cookie is present and the session is valid. */
export function getValidSessionToken(cookies: Record<string, string>): string | null {
  const token = cookies[SESSION_COOKIE]
  if (!token) return null
  const session = authSessionQueries.findValid(token)
  if (!session) return null
  authSessionQueries.touch(token)
  return token
}
