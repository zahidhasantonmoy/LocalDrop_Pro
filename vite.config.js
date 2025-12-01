import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const plugins = [react()];
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
