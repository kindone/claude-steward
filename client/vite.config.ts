import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../', '')
  // In dev, backend may be on 3002 (up:dev) or 3001 (plain npm run dev). PM2 ecosystem sets VITE_API_PORT.
  const apiPort = process.env.VITE_API_PORT || env.VITE_API_PORT || '3001'
  // loadEnv does not strip inline .env comments — strip manually so allowedHosts matches correctly.
  const appDomain = (env.APP_DOMAIN || '').split(/\s+#/)[0].trim()
  return {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      'mdart/preview': path.resolve(__dirname, '../node_modules/mdart/src/tabListInteract.ts'),
      'mdart': path.resolve(__dirname, '../node_modules/mdart/src/index.ts'),
    },
  },
  server: {
    host: true,
    port: 5173,
    ...(appDomain
      ? { allowedHosts: [appDomain, `dev.${appDomain}`] }
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
