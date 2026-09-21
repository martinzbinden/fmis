import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      // Gemeinsame Shell (Login/Auth/Layout/Sync-Client/...), siehe core/frontend/src.
      '@fmis/core': fileURLToPath(new URL('../core/frontend/src', import.meta.url)),
      // Je Modul dessen eigenes, unverändertes frontend/src (Seiten, Komponenten,
      // pglite/Sync-Anbindung) — module.tsx dort baut daraus den ModuleDescriptor.
      '@fmis/livestock': fileURLToPath(new URL('../modules/livestock/frontend/src', import.meta.url)),
      '@fmis/dairy': fileURLToPath(new URL('../modules/dairy/frontend/src', import.meta.url)),
      '@fmis/fields': fileURLToPath(new URL('../modules/fields/frontend/src', import.meta.url)),
      '@fmis/wiesenjournal': fileURLToPath(new URL('../modules/wiesenjournal/frontend/src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Only precache the app shell (JS/CSS/HTML/icons). Data lives in
      // pglite/IndexedDB and must never be handled by the service worker.
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'FMIS',
        short_name: 'FMIS',
        description: 'Farm-Management-Informationssystem',
        theme_color: '#334155',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // App shell only — never cache API/sync calls. Modul-Key-Pattern statt
        // fester Liste, damit weitere Modul-INSTANZEN (z.B. "dairy_schafe",
        // siehe module_registry.py ModuleSpec.source) automatisch mit-denylistet
        // werden, ohne diese Datei anfassen zu müssen.
        navigateFallbackDenylist: [/^\/auth\//, /^\/[a-z_]+\/sync\//, /^\/core\//, /^\/admin\//],
        // pglite's wasm/data assets are large (~10MB) but are part of the
        // app shell (not user data) and must be cached for offline use.
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
      },
    }),
  ],
  server: {
    fs: {
      // core/frontend, modules/*/frontend/src und modules/*/schema liegen
      // zwei Ebenen über frontend/ (Repo-Root), nicht nur eine.
      allow: ['../..'],
    },
    // Erlaubt den Zugriff über eine `*.localhost`-Subdomain (z.B.
    // fmis.localhost:5173) statt nur "localhost" — Browser lösen JEDE
    // *.localhost-Subdomain automatisch auf 127.0.0.1 auf (kein
    // /etc/hosts-Eintrag nötig), aber als EIGENE Origin: eigener
    // Service-Worker-/Cache-/LocalStorage-Namensraum, der nicht mit
    // anderen, unabhängigen Projekten kollidiert, die zufällig denselben
    // Port unter dem blossen "localhost" benutzt haben. Vites
    // DNS-Rebinding-Schutz (server.allowedHosts) würde einen Request mit
    // Host-Header "fmis.localhost" sonst ablehnen.
    allowedHosts: ['.localhost'],
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
})
