/**
 * esbuild script for vscode-mdart.
 *
 * Two bundles:
 *  - dist/extension.js  Node.js / extension host  (CJS, vscode external)
 *  - dist/preview.js    Browser / webview          (IIFE)
 *
 * Usage:
 *   node build.mjs           # production build
 *   node build.mjs --watch   # watch + rebuild on change
 */

import * as esbuild from 'esbuild'
import { argv }     from 'node:process'

const watch   = argv.includes('--watch')
const minify  = !watch

const shared = { bundle: true, minify, sourcemap: watch ? 'inline' : false }

const contexts = await Promise.all([

  // ── Extension host (Node.js) ───────────────────────────────────────────────
  esbuild.context({
    ...shared,
    entryPoints: ['src/extension.ts'],
    platform:    'node',
    format:      'cjs',        // VS Code loads extensions with require()
    external:    ['vscode'],   // provided by the host — never bundle
    outfile:     'dist/extension.js',
  }),

  // ── Preview webview (browser) ─────────────────────────────────────────────
  esbuild.context({
    ...shared,
    entryPoints: ['src/preview.ts'],
    platform:    'browser',
    format:      'iife',
    outfile:     'dist/preview.js',
  }),

])

if (watch) {
  await Promise.all(contexts.map(c => c.watch()))
  console.log('[vscode-mdart] watching…')
} else {
  await Promise.all(contexts.map(c => c.rebuild()))
  await Promise.all(contexts.map(c => c.dispose()))
  console.log('[vscode-mdart] build complete')
}
