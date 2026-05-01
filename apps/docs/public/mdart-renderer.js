/**
 * MdArt client-side renderer for MkDocs.
 *
 * Scans the page for ```mdart fenced code blocks after DOMContentLoaded,
 * dynamically imports the MdArt module, and renders each block as an SVG
 * diagram inserted before the original <pre> block (source stays visible).
 *
 * Supports dark mode via MutationObserver on data-md-color-scheme.
 * MdArt mode: 'dark' (default saturated palettes) / 'light' (off-white BG).
 *
 * Designed to be injected via apps/docs/src/proxy.ts alongside pikchr-renderer.js.
 * To refresh mdart.js after upstream changes: cp ../../mdart/packages/mdart/dist/index.js public/mdart.js
 */
;(function () {
  // MkDocs custom fence `mdart` (via fence_code_format) renders as:
  // <pre class="mdart"><code>SOURCE</code></pre>
  const CODE_BLOCK_SELECTOR = 'pre.mdart code'

  let renderFn = null
  const pendingBlocks = []
  // Track rendered diagrams for dark-mode re-render: [{ wrapper, code }]
  const renderedDiagrams = []

  // ── Theme detection ───────────────────────────────────────────────────────

  function isDarkMode() {
    // MkDocs Material sets data-md-color-scheme="slate" on <body> for dark
    if (document.body && document.body.hasAttribute('data-md-color-scheme')) {
      return document.body.getAttribute('data-md-color-scheme') === 'slate'
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  function getMode() {
    return isDarkMode() ? 'dark' : 'light'
  }

  // ── Module loading ────────────────────────────────────────────────────────

  async function loadModule() {
    try {
      // Dynamic import works in non-module scripts (Chrome 63+, FF 67+, Safari 11.1+)
      const mod = await import('/mdart.js')
      renderFn = mod.renderMdArt
      for (const { code, container } of pendingBlocks) {
        renderBlock(code, container)
      }
      pendingBlocks.length = 0
    } catch (err) {
      console.error('[mdart-renderer] Failed to load mdart module:', err)
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  // container = the <pre class="mdart"> element wrapping the <code>
  function renderBlock(code, container) {
    try {
      const svg = renderFn(code, undefined, { mode: getMode() })
      // Insert diagram before the container; source stays visible below
      container.insertAdjacentHTML('beforebegin', `<div class="mdart-diagram" style="margin:0.5em 0;overflow-x:auto">${svg}</div>`)
      // Remove mdart class so this block isn't re-processed on SPA nav
      container.classList.remove('mdart')
      // Track for dark mode re-rendering
      const wrapper = container.previousElementSibling
      if (wrapper && wrapper.classList.contains('mdart-diagram')) {
        renderedDiagrams.push({ wrapper, code })
      }
    } catch (err) {
      console.error('[mdart-renderer] Render error:', err, '\nSource:', code.slice(0, 80))
    }
  }

  function reRenderAll() {
    if (!renderFn || renderedDiagrams.length === 0) return
    const mode = getMode()
    for (const { wrapper, code } of renderedDiagrams) {
      try {
        const svg = renderFn(code, undefined, { mode })
        // Replace SVG in place — wrapper div stays so layout doesn't shift
        const oldSvg = wrapper.querySelector('svg')
        if (oldSvg) {
          const temp = document.createElement('div')
          temp.innerHTML = svg
          const newSvg = temp.querySelector('svg')
          if (newSvg) oldSvg.outerHTML = newSvg.outerHTML
        } else {
          wrapper.innerHTML = svg
        }
      } catch (err) {
        console.error('[mdart-renderer] Re-render error:', err)
      }
    }
  }

  // ── Page scan ─────────────────────────────────────────────────────────────

  function scanAndRender() {
    const blocks = document.querySelectorAll(CODE_BLOCK_SELECTOR)
    if (blocks.length === 0) return
    for (const codeEl of blocks) {
      // parent is the <div class="mdart"> container from fence_code_format
      const container = codeEl.parentElement
      if (!container) continue
      const src = codeEl.textContent || ''
      if (!renderFn) {
        pendingBlocks.push({ code: src, container })
      } else {
        renderBlock(src, container)
      }
    }
  }

  // ── MkDocs SPA navigation ─────────────────────────────────────────────────

  function setupNavListener() {
    // MkDocs Material uses an RxJS observable for SPA nav; subscribe if present
    if (typeof document$ !== 'undefined' && typeof document$.subscribe === 'function') {
      document$.subscribe(() => {
        renderedDiagrams.length = 0
        scanAndRender()
      })
    }
  }

  // ── Dark mode observer ────────────────────────────────────────────────────

  function setupDarkModeObserver() {
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => reRenderAll())
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-md-color-scheme'],
    })
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAndRender)
  } else {
    scanAndRender()
  }

  loadModule()
  setupNavListener()
  setupDarkModeObserver()
})()
