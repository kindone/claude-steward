import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../', '')
  // In dev, backend may be on 3002 (up:dev) or 3001 (plain npm run dev). PM2 ecosystem sets VITE_API_PORT.
  const apiPort = process.env.VITE_API_PORT || env.VITE_API_PORT || '3001'
  return {
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    ...(env.APP_DOMAIN
      ? { allowedHosts: [env.APP_DOMAIN, `dev.${env.APP_DOMAIN}`] }
      : {}),
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
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
