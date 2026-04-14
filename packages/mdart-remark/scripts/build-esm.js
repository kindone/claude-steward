import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle:    true,
  format:    'esm',
  platform:  'node',
  outdir:    'dist',
  sourcemap: true,
  external:  [
    'mdart',
    'unified',
    'remark-parse',
    'remark-rehype',
    'rehype-stringify',
    'unist-util-visit',
  ],
})

console.log('[mdart-remark] ESM bundle written to dist/')
