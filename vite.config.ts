import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/sortbot/' : '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      input: {
        // Main app (index.html) + the public beta-signup landing page (beta.html)
        main: resolve(__dirname, 'index.html'),
        beta: resolve(__dirname, 'beta.html'),
      },
    },
  },
})
