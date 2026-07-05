import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Baby Feeding Tracker',
        short_name: 'BabyTrack',
        description: 'Track feeding, reflux and symptoms — offline-first.',
        theme_color: '#c4623c',
        background_color: '#f7f5f1',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}', '**/*.wasm'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
})
