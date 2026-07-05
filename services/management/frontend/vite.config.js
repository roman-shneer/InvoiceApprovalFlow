import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:80', // Адрес вашего Node.js сервера
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:80',
        ws: true,
        changeOrigin: true
      }
    }
  }
})
