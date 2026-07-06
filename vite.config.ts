import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// The marketing landing lives INSIDE the app (Landing.tsx, shown to logged-out
// visitors at the main URL). public/beta.html is a redirect stub for old links.
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/sortbot/' : '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
})
