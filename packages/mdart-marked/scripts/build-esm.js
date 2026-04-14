import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle:    true,
  format:    'esm',
  platform:  'node',
  outdir:    'dist',
  sourcemap: true,
  external:  ['mdart', 'marked'],   // peerDependencies — provided by the host
})

console.log('[mdart-marked] ESM bundle written to dist/')
