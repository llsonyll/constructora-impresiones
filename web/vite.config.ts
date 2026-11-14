import { defineConfig } from 'vite'
import { fileURLToPath } from "node:url"
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// VITE_BASE: '/' en Vercel/Netlify; '/constructora-impresiones/app/' si se sirve desde GitHub Pages.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'La Constructora',
        short_name: 'Constructora',
        lang: 'es-PE',
        theme_color: '#b45309',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        navigateFallback: 'index.html',
        runtimeCaching: [{
          // Fotos de productos: se guardan al verlas, para que el POS las muestre sin internet. CacheFirst es seguro
          // porque cada subida usa una ruta nueva (`<id>/<fecha>.jpg`): una foto cambiada nunca reutiliza la URL.
          // ~100 KB cada una → 1500 fotos ≈ 150 MB como máximo; se descartan las menos usadas.
          // Anclada al inicio: Workbox ignora una RegExp que coincide a mitad de una URL de otro dominio (Supabase).
          urlPattern: /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/product-images\//,
          handler: 'CacheFirst',
          options: {
            cacheName: 'product-images',
            // Solo 200 con CORS: una respuesta opaca (status 0) Chrome la cuenta como ~7 MB de cuota.
            cacheableResponse: { statuses: [200] },
            expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 180, purgeOnQuotaError: true },
          },
        }],
      },
    }),
  ],
})
