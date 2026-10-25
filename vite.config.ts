import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Relative base: läuft unter GitHub Pages (/padwerk-1k/), lokal und als Vorschau.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Padwerk 1K',
        short_name: 'Padwerk',
        description: 'Pad-Sampler und Sequencer im Browser – inspiriert von klassischen Pad-Samplern.',
        lang: 'de',
        display: 'standalone',
        orientation: 'any',
        background_color: '#1c1a18',
        theme_color: '#1c1a18',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
});
