import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Register the image-caching Service Worker.
// The SW intercepts all Supabase Storage image requests and caches them for
// 7 days using a stale-while-revalidate strategy, bypassing the `Cache-Control:
// no-cache` header that Supabase Storage free tier sends on every response.
// Without this, 800 images are revalidated on every page refresh.
if ('serviceWorker' in navigator) {
  // Vite sets import.meta.env.BASE_URL to '/' locally and '/sortbot/' on GitHub Actions
  const swUrl = `${import.meta.env.BASE_URL}sw.js`;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        console.debug('[SW] registered, scope:', reg.scope);
      })
      .catch((err) => {
        // Non-fatal — app works fine without the SW, just slower on refresh
        console.debug('[SW] registration failed:', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
