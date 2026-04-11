/**
 * GET /api/link-preview?url=...
 *
 * Server-side proxy that fetches an external URL and extracts a title +
 * description for the Reassembly link preview card. Running this server-side
 * avoids CORS issues and keeps credentials out of the browser.
 *
 * Returns: { title: string, description: string | null }
 */

import { Router } from 'express'

const router = Router()

const TIMEOUT_MS  = 6_000
const MAX_BYTES   = 256 * 1024  // read at most 256 KB of HTML
const EXCERPT_LEN = 220

router.get('/', async (req, res) => {
  const url = (req.query.url as string | undefined) ?? ''

  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: 'Missing or invalid url parameter' })
    return
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Steward/1.0; +preview)',
        'Accept': 'text/html,text/markdown,*/*',
      },
      redirect: 'follow',
    })

    if (!response.ok) {
      res.json({ title: urlToTitle(url), description: null })
      return
    }

    const contentType = response.headers.get('content-type') ?? ''

    // For markdown files return first heading + first paragraph
    if (contentType.includes('text/markdown') || /\.md$/i.test(url)) {
      const text = await response.text()
      const heading = text.match(/^#{1,3}\s+(.+)/m)?.[1]?.trim()
      const para = text.split('\n').find(
        l => l.trim() && !l.startsWith('#') && !l.startsWith('```') && l.length > 20
      )
      res.json({
        title: heading ?? urlToTitle(url),
        description: para?.trim().slice(0, EXCERPT_LEN) ?? null,
      })
      return
    }

    // For HTML: read up to MAX_BYTES then extract <title> + meta description
    const reader = response.body?.getReader()
    if (!reader) {
      res.json({ title: urlToTitle(url), description: null })
      return
    }

    let text = ''
    let bytesRead = 0
    while (bytesRead < MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      text += new TextDecoder().decode(value)
      bytesRead += value.byteLength
      // Stop once we've seen </head> — no need to read the body
      if (text.toLowerCase().includes('</head>')) break
    }
    reader.cancel()

    // Try multiple patterns for each meta — handles both attribute orderings
    const title = extractMeta(text,
      /<title[^>]*>([^<]{1,200})<\/title>/i,
      /<meta[^>]+property="og:title"[^>]+content="([^"]{1,200})"/i,
      /<meta[^>]+content="([^"]{1,200})"[^>]+property="og:title"/i,
    ) ?? urlToTitle(url)

    const description = extractMeta(text,
      /<meta[^>]+property="og:description"[^>]+content="([^"]{1,300})"/i,
      /<meta[^>]+content="([^"]{1,300})"[^>]+property="og:description"/i,
      /<meta[^>]+name="description"[^>]+content="([^"]{1,300})"/i,
      /<meta[^>]+content="([^"]{1,300})"[^>]+name="description"/i,
    )

    res.json({
      title: decodeHtmlEntities(title),
      description: description ? decodeHtmlEntities(description).slice(0, EXCERPT_LEN) : null,
    })
  } catch {
    // Timeout, DNS failure, etc. — return a graceful fallback
    res.json({ title: urlToTitle(url), description: null })
  }
})

function extractMeta(html: string, ...patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re)
    if (m?.[1]?.trim()) return m[1].trim()
  }
  return null
}

function urlToTitle(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname + (u.pathname !== '/' ? u.pathname : '')
  } catch {
    return url
  }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

export default router
