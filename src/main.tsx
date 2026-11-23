import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { log } from './lib/debugLogger'
import { isNative } from './lib/platform'
import { initKeyboard } from './lib/native/keyboard'
import { hydrateBrand } from './lib/brandStore'

// Register the image-caching Service Worker.
// The SW intercepts all Supabase Storage image requests and caches them for
// 7 days using a stale-while-revalidate strategy, bypassing the `Cache-Control:
// no-cache` header that Supabase Storage free tier sends on every response.
// Without this, 800 images are revalidated on every page refresh.
// Skipped in the Capacitor shell: service workers do not run in the iOS WKWebView.
if ('serviceWorker' in navigator && !isNative()) {
  // Vite sets import.meta.env.BASE_URL to '/' locally and '/sortbot/' on GitHub Actions
  const swUrl = `${import.meta.env.BASE_URL}sw.js`;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        log.app(`[SW] registered, scope: ${reg.scope}`);
      })
      .catch((err) => {
        // Non-fatal — app works fine without the SW, just slower on refresh
        log.app(`[SW] registration failed: ${err}`);
      });
  });
}

// Native only: undo the Keyboard plugin's one iOS side effect (it hides the
// keyboard's Done / previous / next bar for every input). No-op on the web.
void initKeyboard();

// The runtime product name (070_runtime_brand.sql). The store already holds the
// build value and the cached one; this replaces them with the founder's current
// choice. Never rejects, and a missing function keeps the build name.
void hydrateBrand();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
