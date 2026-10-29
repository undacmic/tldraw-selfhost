import { defineConfig } from 'vite'

export default defineConfig({
  build: { outDir: 'dist/web' },
  server: {
    proxy: {
      '/sync': { target: 'http://127.0.0.1:5858', ws: true },
      '/healthz': { target: 'http://127.0.0.1:5858' },
      '/api': { target: 'http://127.0.0.1:5858' },
    },
  },
})
