/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../core/frontend/src/**/*.{js,ts,jsx,tsx}',
    '../modules/*/frontend/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Werte kommen aus CSS-Variablen statt festen Hex-Codes — jedes
        // Modul setzt sie über [data-module="..."] in seiner eigenen
        // theme.css neu (siehe modules/<name>/frontend/src/theme.css),
        // damit bg-brand-700 etc. je nach aktivem Modul unterschiedlich
        // aussieht, ohne eine eigene Tailwind-Config pro Modul zu brauchen.
        brand: {
          50: 'var(--brand-50)',
          100: 'var(--brand-100)',
          200: 'var(--brand-200)',
          300: 'var(--brand-300)',
          400: 'var(--brand-400)',
          500: 'var(--brand-500)',
          600: 'var(--brand-600)',
          700: 'var(--brand-700)',
          800: 'var(--brand-800)',
          900: 'var(--brand-900)',
        },
      },
    },
  },
  plugins: [],
}
