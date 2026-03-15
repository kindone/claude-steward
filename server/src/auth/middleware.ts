import type { Request, Response, NextFunction } from 'express'
import { getValidSessionToken } from './session.js'

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = getValidSessionToken(req.cookies ?? {})
  if (token) {
    next()
    return
  }

  res.status(401).json({ error: 'Unauthorized' })
}

/** @deprecated Use requireAuth — left for any existing imports */
export const requireApiKey = requireAuth
