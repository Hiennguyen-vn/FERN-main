import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\/api\/v1\/sync\/pull\/catalog/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'catalog-cache',
              expiration: { maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: /^https?:\/\/.*\/api\/v1\/sync\/pull\/stock/,
            handler: 'NetworkFirst',
            options: { cacheName: 'stock-cache' },
          },
        ],
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'FERN POS',
        short_name: 'FERN POS',
        description: 'Offline-first point of sale for FERN coffee chain',
        theme_color: '#16a34a',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'landscape',
        categories: ['business'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': '/src' },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
