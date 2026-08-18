import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'node:path'

// El panel de la plataforma. Sin react-router: son dos pantallas y meterle un
// router sería más ceremonia que producto.
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  // Puerto propio, para poder tener los tres corriendo a la vez sin pisarse.
  server: { port: 5052, strictPort: true },
  preview: { port: 5052, strictPort: true },
  resolve: {
    alias: {
      '@bicho/shared': path.resolve(import.meta.dirname, '../../packages/shared/src'),
    },
  },
})
