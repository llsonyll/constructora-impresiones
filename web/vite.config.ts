import { defineConfig } from 'vite'
import { fileURLToPath } from "node:url"
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// VITE_BASE: '/' en Vercel/Netlify; '/constructora-impresiones/app/' si se sirve desde GitHub Pages.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Lógica de impresiones compartida con /index.html (app de Firebase) mientras ambas convivan.
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: { fs: { allow: ['..'] } },
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
      workbox: { navigateFallback: 'index.html' },
    }),
  ],
})
