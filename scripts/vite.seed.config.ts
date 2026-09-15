/**
 * Build config for `npm run seed:vocab` ONLY. It bundles scripts/seed-marketplace-vocab.ts
 * for Node with two browser-only modules aliased to stubs: the adapters' import graph
 * reaches src/lib/vocabService.ts (via textAIService → csvExport → shared.ts), which
 * imports the debug logger (`window` at import time) and the Supabase client (throws
 * without env). Neither is used by the seed; both are swapped here so app code stays
 * untouched. Not used by `npm run build`.
 */
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const stub = (name: string) => fileURLToPath(new URL(`./stubs/${name}.ts`, import.meta.url));

export default defineConfig({
  publicDir: false,
  resolve: {
    alias: [
      // Whole-specifier matches, or the unmatched "./" prefix survives into the path.
      { find: /^(\.\.?\/)+(lib\/)?debugLogger$/, replacement: stub('debugLogger') },
      { find: /^(\.\.?\/)+(lib\/)?supabase$/, replacement: stub('supabase') },
    ],
  },
  build: {
    ssr: 'scripts/seed-marketplace-vocab.ts',
    outDir: 'scripts/.seed-build',
    emptyOutDir: true,
    copyPublicDir: false,
    minify: false,
  },
});
