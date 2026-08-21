import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Puerto fijo por consistencia con el resto de las apps (ver
  // apps/dashboard/vite.config.ts), aunque acá nada dependa de una URL exacta:
  // esta app no tiene login ni redirect_uri propio.
  server: { port: 5052, strictPort: true },
  preview: { port: 5052, strictPort: true },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
