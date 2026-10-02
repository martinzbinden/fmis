import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// Eigene Konfiguration statt vite.config.ts, damit Tests nicht das PWA-Plugin
// laden. Getestet werden reine Funktionen (Parser, Kennzahlen, Inzucht) — sie
// liegen in den Modulen neben dem Code, darum die Include-Pfade ausserhalb
// von frontend/.
export default defineConfig({
  resolve: {
    alias: {
      '@fmis/core': fileURLToPath(new URL('../core/frontend/src', import.meta.url)),
      '@fmis/livestock': fileURLToPath(new URL('../modules/livestock/frontend/src', import.meta.url)),
      '@fmis/dairy': fileURLToPath(new URL('../modules/dairy/frontend/src', import.meta.url)),
      '@fmis/fields': fileURLToPath(new URL('../modules/fields/frontend/src', import.meta.url)),
      '@fmis/wiesenjournal': fileURLToPath(new URL('../modules/wiesenjournal/frontend/src', import.meta.url)),
    },
  },
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['core/frontend/src/**/*.test.ts', 'modules/*/frontend/src/**/*.test.ts'],
    environment: 'node',
  },
})
