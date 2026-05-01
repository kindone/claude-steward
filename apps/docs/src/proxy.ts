import http from 'node:http'
import type { Request, Response } from 'express'
import httpProxy from 'http-proxy'
import { getMkDocsPort } from './mkdocs.js'

// Append mtime-based cache-buster so browsers always fetch updated panel files.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function fileMtime(name: string): number {
  try {
    return fs.statSync(path.join(__dirname, '..', 'public', name)).mtimeMs | 0
  } catch { return 0 }
}

function makeInjection(docsDir: string): string {
  const sv = fileMtime('chat-panel.js')
  const cv = fileMtime('chat-panel.css')
  const pv = fileMtime('pikchr-renderer.js')
  const mv = fileMtime('mdart-renderer.js')
  const script = `<script src="/chat-panel.js?v=${sv}"></script>`
  const style  = `<link rel="stylesheet" href="/chat-panel.css?v=${cv}">`
  const pikchrScript = `<script src="/pikchr-renderer.js?v=${pv}"></script>`
  const mdartScript  = `<script src="/mdart-renderer.js?v=${mv}"></script>`
  // Inject docsDir as a global so chat-panel.js can namespace its localStorage
  // keys per docs-project. This prevents cross-contamination when two different
  // docs apps run on the same slot (port/origin) at different times.
  const dirScript = `<script>window.__STEWARD_DOCS_DIR__=${JSON.stringify(docsDir)}</script>`
  return `${style}\n${pikchrScript}\n${mdartScript}\n${dirScript}\n${script}\n</head>`
}

// Create proxy instance — reused for all requests
export const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  selfHandleResponse: false,
})

proxy.on('error', (err, _req, res) => {
  console.error('[proxy] error:', err.message)
  if (res instanceof http.ServerResponse && !res.headersSent) {
    res.writeHead(502)
    res.end(`Docs server unavailable: ${err.message}`)
  }
})

// Middleware: proxy request to MkDocs, injecting chat panel into HTML responses
export function proxyToMkDocs(req: Request, res: Response): void {
  const docsDir: string = req.app.locals.docsDir ?? ''
  const target = `http://127.0.0.1:${getMkDocsPort()}`
  const contentType = ''  // will be determined from response

  // For HTML responses we need to buffer and inject.
  // Intercept via a custom approach: manually forward the request.
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: getMkDocsPort(),
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${getMkDocsPort()}`,
      },
    },
    (proxyRes) => {
      const ct = proxyRes.headers['content-type'] ?? ''

      if (ct.includes('text/html')) {
        // Buffer the HTML, inject the chat panel, send back
        const chunks: Buffer[] = []
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
        proxyRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf8')
          const injection = makeInjection(docsDir)
          // Inject before </head> if present, otherwise before </body>
          if (html.includes('</head>')) {
            html = html.replace('</head>', injection)
          } else {
            html = html.replace('</body>', injection.replace('</head>', '</body>'))
          }

          const buf = Buffer.from(html, 'utf8')
          const headers = { ...proxyRes.headers }
          // Update content-length to match injected size
          headers['content-length'] = String(buf.byteLength)
          // Remove content-encoding — we decoded the body
          delete headers['content-encoding']

          res.writeHead(proxyRes.statusCode ?? 200, headers)
          res.end(buf)
        })
      } else {
        // Pass through as-is
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
        proxyRes.pipe(res)
      }
    },
  )

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).send(`Docs server unavailable: ${err.message}`)
    }
  })

  req.pipe(proxyReq)
}

// WebSocket proxy for MkDocs live-reload
export function proxyWebSocket(
  req: http.IncomingMessage,
  socket: import('node:stream').Duplex,
  head: Buffer,
): void {
  proxy.ws(req, socket, head, {
    target: `ws://127.0.0.1:${getMkDocsPort()}`,
  })
}
