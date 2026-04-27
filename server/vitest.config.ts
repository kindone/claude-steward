import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec,prop}.ts'],
    exclude: ['src/**/*.e2e.test.ts'],    // e2e tests use real Claude CLI — run separately via test:e2e
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    pool: 'forks',   // full process isolation — each file gets a clean module graph
    // 15s default — stateful property tests (e.g. lifecycle.prop) need
    // headroom on small instances where parallel forks compete for CPU.
    // Per-test `{ timeout }` overrides exist but didn't apply consistently
    // under vitest 4.x's fork pool; setting at config level is reliable.
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/index.ts'],
    },
  },
})
