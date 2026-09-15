/** Seed-build stand-in for src/lib/supabase.ts — the real one throws without env and creates a client. */
const chain: unknown = new Proxy(function () { /* no-op */ }, {
  get: () => chain,
  apply: () => chain,
});
export const supabase = chain as never;
