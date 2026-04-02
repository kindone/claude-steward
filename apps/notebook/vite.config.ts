import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: '.',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
  },
  server: {
    port: 5201,
    proxy: {
      '/api': {
        target: 'http://localhost:4001',
        changeOrigin: true,
      },
    },
  },
})
