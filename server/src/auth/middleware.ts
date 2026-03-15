import type { Request, Response, NextFunction } from 'express'
import { getValidSessionToken } from './session.js'

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // 1. Session cookie (Passkey auth)
  const token = getValidSessionToken(req.cookies ?? {})
  if (token) {
    next()
    return
  }

  // 2. Bearer token fallback (API_KEY) — kept during passkey rollout
  const apiKey = process.env.API_KEY
  if (apiKey) {
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ') && authHeader.slice('Bearer '.length) === apiKey) {
      next()
      return
    }
  }

  res.status(401).json({ error: 'Unauthorized' })
}

/** @deprecated Use requireAuth — left for any existing imports */
export const requireApiKey = requireAuth
