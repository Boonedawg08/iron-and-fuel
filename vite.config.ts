import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Relative base + hash routing: the same build works at a domain root (Netlify)
// and under a sub-path (GitHub Pages: https://user.github.io/repo/).
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Iron & Fuel',
        short_name: 'Iron & Fuel',
        description: 'Offline workout and nutrition tracker.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0d10',
        theme_color: '#0b0d10',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache everything, including the bundled USDA food database.
        globPatterns: ['**/*.{js,css,html,png,svg,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
