/**
 * Pikchr WASM renderer.
 *
 * Lazily loads /pikchr.js (self-contained Emscripten build with embedded WASM)
 * and exposes renderPikchr() which converts pikchr source to an SVG string.
 *
 * The module is loaded once and cached for the lifetime of the page.
 * renderPikchr() itself is synchronous after the first call (the WASM ccall
 * runs in the same thread once the module is initialized).
 */

interface PikchrMod {
  ccall: (name: string, returnType: string, argTypes: string[], args: unknown[]) => number
  UTF8ToString: (ptr: number) => string
  _malloc: (bytes: number) => number
  _free: (ptr: number) => void
}

declare global {
  interface Window {
    PikchrModule?: () => Promise<PikchrMod>
  }
}

let _modPromise: Promise<PikchrMod> | null = null

function getPikchrMod(): Promise<PikchrMod> {
  if (_modPromise) return _modPromise

  _modPromise = new Promise<PikchrMod>((resolve, reject) => {
    const init = () => {
      if (typeof window.PikchrModule === 'function') {
        window.PikchrModule().then(resolve).catch(reject)
      } else {
        reject(new Error('PikchrModule not defined after script load'))
      }
    }

    if (typeof window.PikchrModule === 'function') {
      // Already loaded (e.g. HMR)
      init()
    } else {
      const script = document.createElement('script')
      script.src = '/pikchr.js'
      script.onload = init
      script.onerror = () => reject(new Error('Failed to load /pikchr.js'))
      document.head.appendChild(script)
    }
  })

  return _modPromise
}

/**
 * Render pikchr source to an SVG string.
 *
 * Returns an SVG string on success or a <div class="pikchr-error"> string on failure.
 * Throws only if the WASM module itself fails to load.
 */
export async function renderPikchr(src: string): Promise<string> {
  const mod = await getPikchrMod()

  // Allocate 4-byte slots for the width/height output params
  const pWidth  = mod._malloc(4)
  const pHeight = mod._malloc(4)

  try {
    // char* pikchr(const char* zIn, const char* zClass, unsigned int mFlags,
    //              int* pnWidth, int* pnHeight)
    // Returns a malloc'd SVG string (caller must free), or an error message
    // with width set to -1.
    const resultPtr = mod.ccall(
      'pikchr',
      'number',                                        // return: char* as raw pointer
      ['string', 'string', 'number', 'number', 'number'],
      [src, 'pikchr', 0, pWidth, pHeight],
    )

    if (!resultPtr) return `<div class="pikchr-error">pikchr: null result</div>`

    const output = mod.UTF8ToString(resultPtr)
    mod._free(resultPtr)

    // pikchr returns "<svg ..." on success and "<div class='error'..." on failure.
    // Checking the output prefix is cleaner than reading *pnWidth via HEAP32
    // (which requires HEAP32 in EXPORTED_RUNTIME_METHODS).
    if (!output.trimStart().startsWith('<svg')) {
      return `<div class="pikchr-error"><pre>${escapeHtml(output)}</pre></div>`
    }

    return output
  } finally {
    mod._free(pWidth)
    mod._free(pHeight)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
