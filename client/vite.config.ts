import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../', '')
  return {
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    ...(env.APP_DOMAIN ? { allowedHosts: [env.APP_DOMAIN] } : {}),
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
  }
})
