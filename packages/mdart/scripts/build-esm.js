/**
 * esbuild step — produces ESM bundles for dist/index.js and dist/tabListInteract.js.
 * Run after `tsc -p tsconfig.build.json` (which emits the .d.ts files).
 */

import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: [
    'src/index.ts',
    'src/tabListInteract.ts',
  ],
  bundle:    true,
  format:    'esm',
  platform:  'neutral',   // no Node/browser shims — pure ES
  outdir:    'dist',
  sourcemap: true,
  // No external deps — all source is internal to this package
})

console.log('[mdart] ESM bundles written to dist/')
