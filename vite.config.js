// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        // Entradas HTML (multi-page)
        main: resolve(__dirname, 'index.html'),
        confirm: resolve(__dirname, 'confirm.html'),
      },
    },
  },
  server: { port: 5173 },
})
