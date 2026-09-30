import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonts/*.woff2', 'favicon.svg', 'icons/*.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Google APIs + Drive are called live; never serve stale API responses.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*(googleapis|drive\.google|accounts\.google)\.com\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        id: '/khata/',
        name: 'Khata — Personal Budget',
        short_name: 'Khata',
        description:
          'Offline-first personal budget tracker with spending insights and encrypted Google Drive backups.',
        lang: 'en-IN',
        dir: 'ltr',
        start_url: './index.html',
        scope: './',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        orientation: 'portrait-primary',
        background_color: '#14110F',
        theme_color: '#14110F',
        categories: ['finance', 'productivity', 'utilities'],
        prefer_related_applications: false,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        screenshots: [
          { src: 'icons/shot-wide.png', sizes: '1280x720', type: 'image/png', form_factor: 'wide' },
          { src: 'icons/shot-narrow.png', sizes: '540x960', type: 'image/png', form_factor: 'narrow' },
        ],
        shortcuts: [
          { name: 'Add expense', short_name: 'Add', url: './?action=expense' },
          { name: 'Add income', short_name: 'Income', url: './?action=income' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    cssTarget: 'safari16',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
})
