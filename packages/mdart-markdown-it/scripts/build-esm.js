import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle:    true,
  format:    'esm',
  platform:  'node',
  outdir:    'dist',
  sourcemap: true,
  external:  ['mdart', 'markdown-it'],
})

console.log('[mdart-markdown-it] ESM bundle written to dist/')
