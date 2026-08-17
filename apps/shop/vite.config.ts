import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  // basicSsl: WhatsApp/Safari reescriben los links tocados a https:// antes de
  // abrirlos, sin importar con qué esquema los mandemos nosotros. Sin esto, el
  // dev server (que solo hablaba http) rechaza la conexión directamente. Con
  // el certificado autofirmado, Safari muestra un aviso una vez ("no es
  // privado" → "visitar de todos modos") y después funciona normal.
  plugins: [react(), tailwindcss(), basicSsl()],
  // basicSsl() ya se autoconfigura para servir https; no hace falta pasar
  // https:true acá a mano.
  // Puerto fijo, no el que Vite elija según qué más esté corriendo.
  server: { port: 5050, strictPort: true },
  preview: { port: 5050, strictPort: true },
  resolve: {
    alias: {
      // Un solo import relativo hacia el paquete compartido, no un symlink de
      // workspace: así funciona igual en dev y en el build de producción.
      '@bicho/shared': path.resolve(import.meta.dirname, '../../packages/shared/src'),
    },
  },
})
