// apps/web/vite.config.ts
// docs: 08-frontend-app.md
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Allow LAN access for iPhone testing (docs/10 §6).
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'tilesets/*.png', 'sprites/*.png', 'sfx/*'],
      manifest: false, // we ship our own public/manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ogg,wav}'],
        // Today's daily level: network-first with a short cache fallback.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('/api/daily'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'mr-daily', expiration: { maxEntries: 1, maxAgeSeconds: 86400 } },
          },
        ],
      },
    }),
  ],
})
