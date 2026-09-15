/** Seed-build stand-in for src/lib/debugLogger.ts — the real one touches `window` at import. */
type Fn = (...args: unknown[]) => void;
const noop: Fn = () => undefined;
export const log: Record<string, Fn> = new Proxy({}, { get: () => noop });
export const dbg: Fn = noop;
export const isDebugEnabled = (): boolean => false;
export const setDebugEnabled: Fn = noop;
