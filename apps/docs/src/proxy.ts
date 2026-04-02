import http from 'node:http'
import type { Request, Response } from 'express'
import httpProxy from 'http-proxy'
import { getMkDocsPort } from './mkdocs.js'

const CHAT_SCRIPT_TAG = '<script src="/chat-panel.js"></script>'
const CHAT_STYLE_TAG = '<link rel="stylesheet" href="/chat-panel.css">'
const INJECTION = `${CHAT_STYLE_TAG}\n${CHAT_SCRIPT_TAG}\n</head>`

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
          // Inject before </head> if present, otherwise before </body>
          if (html.includes('</head>')) {
            html = html.replace('</head>', INJECTION)
          } else {
            html = html.replace('</body>', `${CHAT_SCRIPT_TAG}\n${CHAT_STYLE_TAG}\n</body>`)
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
