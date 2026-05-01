/**
 * pikchr-renderer.js — Client-side Pikchr WASM renderer for MkDocs
 *
 * Scans the page for pikchr code blocks after DOMContentLoaded,
 * loads the WASM module, and replaces each block with the rendered SVG
 * inside a dark background container.
 *
 * Designed to be injected via apps/docs/src/proxy.ts alongside chat-panel.js.
 */
(function () {
  'use strict'

  const WASM_PATH = '/pikchr.js'
  const SVG_CLASS = 'pikchr-svg'
  const CODE_BLOCK_SELECTOR = 'pre.pikchr-pre > code'
  // Light mode: black strokes, transparent wrapper
  const FLAGS = 0

  let moduleReady = false
  let pikchrFn = null
  let pikchrModule = null
  const pendingBlocks = []

  async function loadModule () {
    try {
      pikchrModule = await initPikchrModule({
        locateFile: (path) => WASM_PATH.replace('pikchr.js', path)
      })

      pikchrFn = pikchrModule.cwrap('pikchr', 'string', [
        'string', 'string', 'number', 'number', 'number'
      ])

      moduleReady = true
    } catch (err) {
      console.error('[pikchr-renderer] Failed to load WASM module:', err)
      return
    }

    while (pendingBlocks.length > 0) {
      renderBlock(pendingBlocks.shift())
    }
  }

  function renderBlock (el) {
    if (!moduleReady || !pikchrFn) return

    const code = el.textContent || ''
    if (!code.trim()) return

    const pre = el.parentElement
    if (!pre || pre.tagName !== 'PRE') return

    const stack = pikchrModule.stackSave()
    const widthPtr = pikchrModule.stackAlloc(4)
    const heightPtr = pikchrModule.stackAlloc(4)

    try {
      const svg = pikchrFn(code, SVG_CLASS, FLAGS, widthPtr, heightPtr)

      if (svg && svg.startsWith('<div')) {
        pre.outerHTML = `<div class="pikchr-error" style="color:#f44;padding:1em;border:1px solid #f44;border-radius:4px">${svg}</div>`
      } else if (svg) {
        const m = svg.match(/viewBox="[\d.]+\s+[\d.]+\s+([\d.]+)\s/)
        const vw = m ? Math.floor(parseFloat(m[1])) : 600
        pre.outerHTML = `<div class="pikchr-diagram" style="max-width:${vw}px;margin:0.5em 0">${svg}</div>`
      } else {
        pre.outerHTML = `<pre class="pikchr-error">Pikchr returned empty result</pre>`
      }
    } catch (err) {
      console.error('[pikchr-renderer] Render error:', err)
      pre.outerHTML = `<pre class="pikchr-error">Pikchr render error: ${err.message}</pre>`
    } finally {
      pikchrModule.stackRestore(stack)
    }
  }

  function scanAndRender () {
    const blocks = document.querySelectorAll(CODE_BLOCK_SELECTOR)
    if (blocks.length === 0) return

    blocks.forEach((block) => {
      if (moduleReady) {
        renderBlock(block)
      } else {
        pendingBlocks.push(block)
      }
    })
  }

  function setupNavListener () {
    if (typeof document$ !== 'undefined' && typeof document$.subscribe === 'function') {
      document$.subscribe(() => {
        scanAndRender()
      })
    }
  }

  function loadPikchrScript () {
    if (typeof self.initPikchrModule === 'function') {
      loadModule()
      return
    }

    const script = document.createElement('script')
    script.src = WASM_PATH
    script.onload = loadModule
    script.onerror = () => { /* silent */ }
    document.head.appendChild(script)
  }

  // Init
  if (typeof document$ !== 'undefined' && typeof document$.subscribe === 'function') {
    document$.subscribe(() => {
      scanAndRender()
    })
  } else {
    document.addEventListener('DOMContentLoaded', scanAndRender)
  }

  loadPikchrScript()
  setupNavListener()
})()
