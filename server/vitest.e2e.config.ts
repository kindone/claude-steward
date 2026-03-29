import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.e2e.test.ts'],
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    pool: 'forks',
  },
})
