import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const plugins = [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      manifest: {
        name: 'LocalDrop Pro',
        short_name: 'LocalDrop',
        theme_color: '#0f3460',
        background_color: '#0f3460',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png', // User needs to provide these
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ],
        share_target: {
          action: '/share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'file',
                accept: ['*/*']
              }
            ]
          }
        }
      }
    })
  ];

  if (command === 'serve') {
    plugins.push(mkcert());
  }

  return {
    plugins,
    server: {
      host: true, // Expose to local network
      https: command === 'serve', // Required for WebRTC in dev
      proxy: {
        '/socket.io': {
          target: 'http://localhost:3000',
          ws: true,
          changeOrigin: true
        }
      }
    }
  }
})
