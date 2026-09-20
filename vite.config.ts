import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Dev-only CSP widening for a locally-run matting service.
 *
 * The production policy is the `<meta http-equiv>` in index.html (GitHub Pages
 * cannot send headers, AGENTS.md §9) and it names `https://matting.arcadian.ltd`
 * exactly. Running the service on `localhost:8080` while developing would
 * therefore be blocked — silently, because a blocked subresource fails with no
 * visible error, which is the exact failure §18 #25 warns about.
 *
 * So this appends ONE origin to `connect-src`, and only when `command ===
 * 'serve'`. `vite build` never sees it, so the shipped policy is byte-identical
 * to the file on disk — the mechanism AGENTS.md §9 already names for exactly
 * this situation.
 */
function devMattingCsp(): Plugin {
  return {
    name: 'dev-matting-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      /* Anchored on `connect-src 'self'`, NOT on the bare directive name: the
         rationale comment above the meta tag also contains the words
         "connect-src" and a semicolon, so a looser pattern rewrites the comment
         and leaves the real policy untouched — silently, which is the whole
         failure mode this plugin exists to avoid. */
      return html.replace(
        /(connect-src 'self'[^;]*)(;)/,
        (_m, directive: string, end: string) => `${directive} http://localhost:8080 ws://localhost:8080${end}`,
      );
    },
  };
}

// https://vite.dev/config/
// The marketing landing lives INSIDE the app (Landing.tsx, shown to logged-out
// visitors at the main URL). public/beta.html is a redirect stub for old links.
export default defineConfig({
  plugins: [react(), devMattingCsp()],
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
})
