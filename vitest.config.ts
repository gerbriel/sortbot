import { defineConfig } from 'vitest/config';

// Test config is kept separate from vite.config.ts so the production build
// config never changes for test reasons.
export default defineConfig({
  test: {
    environment: 'happy-dom', // provides localStorage for tombstone/compress-guard code
    include: ['src/**/*.test.{ts,tsx}'],
    // src/lib/supabase.ts throws at import time without these. Tests never hit
    // the network — the dummy client just has to construct.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key-not-real',
    },
  },
});
