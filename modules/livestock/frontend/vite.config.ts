import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Only precache the app shell (JS/CSS/HTML/icons). Data lives in
      // pglite/IndexedDB and must never be handled by the service worker.
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Mastplaner',
        short_name: 'Mastplaner',
        description: 'Lämmermast-Überwachungstool',
        theme_color: '#166534',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        // App shell only — never cache API/sync calls.
        navigateFallbackDenylist: [/^\/auth\//, /^\/sync\//],
        // pglite's wasm/data assets are large (~10MB) but are part of the
        // app shell (not user data) and must be cached for offline use.
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
      },
    }),
  ],
  server: {
    fs: {
      // Allow importing schema/*.sql and seed/*.csv from outside frontend/.
      allow: ['..'],
    },
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
})
