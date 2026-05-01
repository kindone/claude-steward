/**
 * pikchr-renderer.js — Client-side Pikchr WASM renderer for MkDocs
 *
 * Scans the page for pikchr code blocks after DOMContentLoaded,
 * loads the WASM module, and replaces each block with the rendered SVG
 * inside a transparent wrapper container.
 *
 * Supports dark mode via MutationObserver on data-md-color-scheme.
 * Pikchr flag 0x02 = white strokes (dark), 0x00 = black strokes (light).
 *
 * Designed to be injected via apps/docs/src/proxy.ts alongside chat-panel.js.
 */
(function () {
  'use strict'

  const WASM_PATH = '/pikchr.js'
  const SVG_CLASS = 'pikchr-svg'
  const CODE_BLOCK_SELECTOR = 'pre.pikchr-pre > code'
  const FLAG_DARK = 0x02
  const FLAG_LIGHT = 0x00

  let moduleReady = false
  let pikchrFn = null
  let pikchrModule = null
  const pendingBlocks = []
  // Track rendered diagrams: { wrapper, code } so we can re-render on theme change
  const renderedDiagrams = []

  function isDarkMode () {
    // Check MkDocs Material's data-md-color-scheme attribute first
    const body = document.body
    if (body && body.hasAttribute('data-md-color-scheme')) {
      const scheme = body.getAttribute('data-md-color-scheme')
      // 'slate' = dark mode in Material for MkDocs
      return scheme === 'slate'
    }
    // Fallback to CSS media query
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  function getFlags () {
    return isDarkMode() ? FLAG_DARK : FLAG_LIGHT
  }

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
      const svg = pikchrFn(code, SVG_CLASS, getFlags(), widthPtr, heightPtr)

      if (svg && svg.startsWith('<div')) {
        pre.outerHTML = `<div class="pikchr-error" style="color:#f44;padding:1em;border:1px solid #f44;border-radius:4px">${svg}</div>`
      } else if (svg) {
        const m = svg.match(/viewBox="[\d.]+\s+[\d.]+\s+([\d.]+)\s/)
        const vw = m ? Math.floor(parseFloat(m[1])) : 600
        const diagramHtml = `<div class="pikchr-diagram" data-pikchr-src="${encodeURIComponent(code)}" style="max-width:${vw}px;margin:0.5em 0">${svg}</div>`
        // Insert diagram before the code block, keep the code visible
        pre.insertAdjacentHTML('beforebegin', diagramHtml)
        // Remove pikchr-pre class so it doesn't get re-processed on nav
        pre.classList.remove('pikchr-pre')
        // Track for dark mode re-rendering
        const wrapper = pre.previousElementSibling
        if (wrapper && wrapper.classList.contains('pikchr-diagram')) {
          renderedDiagrams.push({ wrapper, code })
        }
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

  function reRenderAll () {
    if (!moduleReady || !pikchrFn || renderedDiagrams.length === 0) return

    const flags = getFlags()
    const stack = pikchrModule.stackSave()
    const widthPtr = pikchrModule.stackAlloc(4)
    const heightPtr = pikchrModule.stackAlloc(4)

    try {
      for (const { wrapper, code } of renderedDiagrams) {
        const svg = pikchrFn(code, SVG_CLASS, flags, widthPtr, heightPtr)
        if (svg && !svg.startsWith('<div')) {
          // Only update the SVG child, preserve wrapper attributes
          const oldSvg = wrapper.querySelector('svg')
          if (oldSvg) {
            const temp = document.createElement('div')
            temp.innerHTML = svg
            const newSvg = temp.querySelector('svg')
            if (newSvg) {
              // Preserve any attributes the wrapper might have inherited
              oldSvg.outerHTML = newSvg.outerHTML
            }
          }
        }
      }
    } catch (err) {
      console.error('[pikchr-renderer] Re-render error:', err)
    } finally {
      pikchrModule.stackRestore(stack)
    }
  }

  function setupDarkModeObserver () {
    if (typeof MutationObserver === 'undefined') return

    const observer = new MutationObserver(() => {
      reRenderAll()
    })

    // Watch for data-md-color-scheme changes on the body
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-md-color-scheme']
    })
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
        // Clear tracked diagrams on navigation (new page)
        renderedDiagrams.length = 0
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
  setupDarkModeObserver()
})()
