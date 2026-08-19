import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'node:path'

// El portal del cadete. Sin react-router: una sola pantalla (la lista de
// entregas), mismo criterio que apps/admin.
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  // Puerto propio, siguiente libre después de dashboard (5051) y admin (5052).
  server: { port: 5053, strictPort: true },
  preview: { port: 5053, strictPort: true },
  resolve: {
    alias: {
      '@bicho/shared': path.resolve(import.meta.dirname, '../../packages/shared/src'),
    },
  },
})
