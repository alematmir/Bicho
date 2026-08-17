import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  // basicSsl: Mercado Pago (como WhatsApp/Safari antes) exige un redirect_uri
  // servido por https — ver la nota en apps/shop/vite.config.ts, mismo motivo.
  plugins: [react(), tailwindcss(), basicSsl()],
  // Puerto fijo: tanto el magic link de Supabase Auth como el redirect_uri de
  // Mercado Pago apuntan a una URL exacta registrada en el panel de cada uno.
  // Si el puerto cambia de corrida en corrida, esos redirects dejan de matchear.
  // basicSsl() ya se autoconfigura para servir https; no hace falta (y en
  // esta versión de Vite ni tipa bien) pasar https:true acá a mano.
  server: { port: 5051, strictPort: true },
  preview: { port: 5051, strictPort: true },
  resolve: {
    alias: {
      '@bicho/shared': path.resolve(import.meta.dirname, '../../packages/shared/src'),
    },
  },
})
