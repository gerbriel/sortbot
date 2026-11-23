/**
 * The product name, in one place. It has been renamed several times (history
 * in AGENTS.md §1 "Naming"); each time only user-visible text changed. The values live in the root brand.json; every rendered mention
 * in src/ reads them through these typed constants. The static files that
 * cannot import (index.html, the manifest, beta.html, capacitor.config.ts,
 * Info.plist, strings.xml, the CI title checks) are rewritten from the same
 * JSON by `npm run brand:apply` (scripts/apply-brand.mjs).
 *
 * Identifiers are NOT brand copy and stay put: the arcadian.ltd domain, the
 * ltd.arcadian.app appId, the sortbot_* storage keys and the ACD- SKU prefix.
 */
import brand from '../brand.json';

/** The product name as rendered everywhere ("SQRL"). */
export const BRAND: string = brand.name;

/** The meta description, also the landing page's lead sentence. */
export const BRAND_TAGLINE: string = brand.tagline;

/** The marketing page's descriptive tab title (the static <title> stays bare BRAND). */
export const BRAND_TITLE_LANDING: string = brand.landingTitle;

/** The single letter on the app icon / logo tile. */
export const BRAND_MARK: string = brand.mark;
