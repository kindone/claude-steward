import type { Request, Response, NextFunction } from 'express'

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'API_KEY not configured on server' })
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' })
    return
  }

  const provided = authHeader.slice('Bearer '.length)
  if (provided !== apiKey) {
    res.status(403).json({ error: 'Invalid API key' })
    return
  }

  next()
}
