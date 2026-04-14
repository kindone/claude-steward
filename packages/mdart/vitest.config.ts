import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',   // tabListInteract.test.ts needs DOM APIs
    globals:     true,
  },
})
