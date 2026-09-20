import { supabase } from './supabase';
import { log } from './debugLogger';
import { normalizePlatformRules, type PlatformPricingRule } from './platformPricing';

/**
 * descriptionSettings — per-workspace control over how the generated listing
 * description is formatted (the rule-based text engine in textAIService).
 *
 * Stored as a JSONB column on organizations (org_description_settings.sql).
 * Org owners/admins edit it in the Workspace panel; existing RLS already
 * covers it (members SELECT their org, admins UPDATE it). Every field has a
 * default matching today's output, so a missing column, missing row, or empty
 * object produces byte-identical descriptions (locked by the golden test).
 */

/* ── Photo backgrounds ──────────────────────────────────────────────────────
 *
 * The workspace's ONE background recipe: cut the garment out, paste it on a
 * flat colour at a fixed canvas size. The self-hosted matting service
 * (VITE_MATTING_URL, AGENTS.md §9) renders it; this type is the contract
 * between the two, and `presetHash` is how both sides agree that a stored
 * composite was made with the settings currently in force.
 *
 * It lives inside `description_settings` (JSONB, already migrated) for the same
 * reason `platformPricing` does: it is per-workspace presentation policy, it is
 * edited on the same Settings tab, and it needs no schema change. Also like
 * `platformPricing`, it is NORMALISED on every read — it is free-form JSON that
 * drives an image pipeline, so a malformed value is dropped centrally rather
 * than defended against at each use.
 *
 * NOTHING GENERATIVE: a flat colour and a rectangle. The composite is a
 * deterministic function of (mask, preset), which is what makes `bgPreset`
 * meaningful — a stored composite whose hash no longer matches the workspace's
 * preset was made with different settings and can be re-run.
 */

export type BackgroundAnchor = 'center' | 'top';

/**
 * A PHOTO backdrop: a linen sheet, a studio wall, a wooden floor. The cut-out
 * is pasted onto this image instead of onto `color`.
 *
 * It is a STORAGE PATH, not a URL — the same rule as everywhere else in this
 * app (§11): a URL is derived from a path through `lib/storageUrls`, and the
 * service reads the file with its own credentials. Paths live under the
 * uploader's own uid prefix (`<uuid>/backdrops/<file>`) so the existing storage
 * policies cover them with nothing new to write.
 *
 * `fit` is spelled out rather than assumed so the service never has to guess,
 * and so a second mode is one value away. It is NOT part of the preset hash
 * (see `backgroundPresetCanonical`) because there is only one mode today; the
 * day a `contain` arrives, the canonical string has to gain it — a composite
 * built the other way round genuinely looks different.
 */
export interface BackgroundBackdrop {
  /** `<uuid>/backdrops/<file>` in the product-images bucket. */
  storagePath: string;
  /** Cover-crop the backdrop to the square canvas. Letterboxing it would show
   *  the flat colour the backdrop was chosen to replace. */
  fit: 'cover';
}

/**
 * One backdrop in the WORKSPACE'S LIBRARY (`description_settings.backdrops`).
 *
 * The library and the preset are deliberately separate: the preset names ONE
 * backdrop (that is the recipe), the library is the few a shop has uploaded and
 * switches between. Storing the pixels' dimensions here means the Settings list
 * can say `2048 × 1365` without loading eight full-size photos to measure them.
 */
export interface WorkspaceBackdrop {
  /** Stable key for React and for Remove. The storage path when none was stored. */
  id: string;
  storagePath: string;
  /** What the seller calls it. Falls back to the file name. */
  name: string;
  /** Pixel size at upload time. 0 when unknown (an older row) — the UI omits it. */
  width: number;
  height: number;
  /** ISO timestamp. '' when unknown. */
  addedAt: string;
}

/** How many backdrops a workspace may keep. Small on purpose: this is a
 *  shop's two or three surfaces, not an asset manager. */
export const BACKDROPS_MAX = 8;
/** A backdrop source file over this is rejected with a sentence rather than
 *  silently downscaled — a 20 MB upload on a rural connection is worth asking
 *  about, and the downscale below turns anything reasonable into ~500 KB. */
export const BACKDROP_MAX_BYTES = 4 * 1024 * 1024;
/** The long side a backdrop is downscaled to before upload, and its JPEG
 *  quality. 2048 is the canvas ceiling anyone picks, so a larger file is bytes
 *  the service would throw away. */
export const BACKDROP_MAX_PX = 2048;
export const BACKDROP_QUALITY = 0.9;

/** `<uuid>/backdrops/<file>` — the uploader's own uid prefix, which is what
 *  makes the existing storage policies cover these files (§16). */
const BACKDROP_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/backdrops\/[^/]+$/i;

export function isBackdropStoragePath(raw: unknown): boolean {
  return typeof raw === 'string' && BACKDROP_PATH_RE.test(raw);
}

/**
 * Coerce a stored backdrop, or drop it.
 *
 * A path that is not one of ours is DROPPED rather than repaired: this string
 * is handed to a service that fetches it with the service role, so anything but
 * the shape we write ourselves is not something to guess at. Dropping it falls
 * back to the flat colour, which is the one safe backdrop.
 */
export function normalizeBackgroundBackdrop(raw: unknown): BackgroundBackdrop | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  const storagePath = typeof e.storagePath === 'string' ? e.storagePath.trim() : '';
  if (!isBackdropStoragePath(storagePath)) return null;
  return { storagePath, fit: 'cover' };
}

/**
 * WHERE a backdrop file goes: `{userId}/backdrops/{timestamp}-{slug}.jpg`.
 *
 * The uid prefix is not decoration — `security_storage_policies.sql` scopes
 * writes by the leading path segment, so a backdrop under the uploader's own uid
 * needs no new policy. The timestamp makes the name unique without a lookup, and
 * the slug keeps it recognisable in a bucket listing. Always `.jpg`, because the
 * upload is always re-encoded as one.
 */
export function backdropStoragePath(userId: string, fileName: string): string {
  const slug = fileName
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'backdrop';
  return `${userId}/backdrops/${Date.now()}-${slug}.jpg`;
}

/** The file name out of a storage path, used as a backdrop's fallback name. */
function backdropFileName(storagePath: string): string {
  const last = storagePath.split('/').pop() ?? '';
  return last.replace(/\.[^.]+$/, '') || 'Backdrop';
}

/**
 * Coerce the workspace's backdrop library. Same contract as
 * `normalizePlatformRules`: junk is dropped, not defended against at each use.
 *
 * Entries with an unusable path go, duplicates collapse (two rows for one file
 * are two chips that do the same thing), and the list is capped at
 * `BACKDROPS_MAX` keeping the FIRST — the array is append-ordered, so the
 * oldest are the ones a preset is most likely to be pointing at.
 */
export function normalizeBackdropLibrary(raw: unknown): WorkspaceBackdrop[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: WorkspaceBackdrop[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const storagePath = typeof e.storagePath === 'string' ? e.storagePath.trim() : '';
    if (!isBackdropStoragePath(storagePath) || seen.has(storagePath)) continue;
    seen.add(storagePath);
    const name = typeof e.name === 'string' && e.name.trim()
      ? e.name.trim().slice(0, 60)
      : backdropFileName(storagePath);
    out.push({
      id: typeof e.id === 'string' && e.id.trim() ? e.id.trim().slice(0, 60) : storagePath,
      storagePath,
      name,
      width: Math.max(0, Math.round(clampNumber(e.width, 0, 65535, 0))),
      height: Math.max(0, Math.round(clampNumber(e.height, 0, 65535, 0))),
      addedAt: typeof e.addedAt === 'string' && !Number.isNaN(Date.parse(e.addedAt))
        ? e.addedAt
        : '',
    });
    if (out.length >= BACKDROPS_MAX) break;
  }
  return out;
}

export interface BackgroundPreset {
  /** Stable key for React and for "which recipe is this". Not part of the hash —
   *  renaming a preset must not invalidate every composite ever made with it. */
  id: string;
  /** Output square, in pixels. Shopify wants >= 2048 on the long edge. */
  canvas: number;
  /** The backdrop, `#RRGGBB`. Stored upper-case by the hash, any case by the form.
   *  Used when `backdrop` is null — the flat-colour default. */
  color: string;
  /** A PHOTO backdrop instead of the flat colour, or null for the colour.
   *  Null by default: a plain light field is what Google Shopping asks for, and
   *  a photo backdrop is a deliberate choice for a shop's own store. */
  backdrop: BackgroundBackdrop | null;
  /** Margin around the garment, as a FRACTION of the canvas (0.10 = 10% each side). */
  padding: number;
  /** Where the garment sits when it does not fill the frame. 'top' is right for
   *  hanging shots, which read wrong when they float in the middle. */
  anchor: BackgroundAnchor;
  /** A soft contact shadow under the garment. Off by default — a shadow is a
   *  judgement call and several marketplaces reject anything but a flat field. */
  shadow: boolean;
  /** JPEG quality of the composite, 60-95. */
  quality: number;
}

export const DEFAULT_BACKGROUND_PRESET: BackgroundPreset = {
  id: 'white-2048',
  canvas: 2048,
  color: '#FFFFFF',
  backdrop: null,
  padding: 0.10,
  anchor: 'center',
  shadow: false,
  quality: 90,
};

export const BACKGROUND_CANVAS_MIN = 512;
export const BACKGROUND_CANVAS_MAX = 4096;
export const BACKGROUND_PADDING_MAX = 0.4;
export const BACKGROUND_QUALITY_MIN = 60;
export const BACKGROUND_QUALITY_MAX = 95;

/** The neutral backdrops offered as chips. Flat, light, and none of them a
 *  brand colour — a coloured backdrop is what makes a catalogue look homemade. */
export const BACKGROUND_COLORS: ReadonlyArray<{ hex: string; label: string }> = [
  { hex: '#FFFFFF', label: 'White' },
  { hex: '#FAFAFA', label: 'Off white' },
  { hex: '#F4F4F4', label: 'Light grey' },
  { hex: '#EDEAE4', label: 'Bone' },
  { hex: '#E4E4E4', label: 'Grey' },
  { hex: '#111111', label: 'Near black' },
];

const clampNumber = (raw: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/** `#RRGGBB` upper-case, or the default. `#abc` shorthand is expanded because
 *  a colour input can emit either and the hash must not see two spellings of
 *  one colour. */
export function normalizeBackgroundColor(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  const full = /^#?([0-9a-f]{6})$/i.exec(s);
  return full ? `#${full[1]}`.toUpperCase() : DEFAULT_BACKGROUND_PRESET.color;
}

/**
 * Coerce whatever is in the JSONB into a usable preset.
 *
 * Every field falls back rather than failing: this drives an image pipeline
 * that runs unattended over hundreds of photos, so a junk `padding` must mean
 * "the default margin", never a crash or a 400-pixel border.
 */
export function normalizeBackgroundPreset(raw: unknown): BackgroundPreset {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_BACKGROUND_PRESET };
  const e = raw as Record<string, unknown>;
  const id = typeof e.id === 'string' && e.id.trim() ? e.id.trim().slice(0, 60) : DEFAULT_BACKGROUND_PRESET.id;
  return {
    id,
    // Canvas is rounded to an integer: a fractional pixel size is not a size.
    canvas: Math.round(clampNumber(e.canvas, BACKGROUND_CANVAS_MIN, BACKGROUND_CANVAS_MAX, DEFAULT_BACKGROUND_PRESET.canvas)),
    color: normalizeBackgroundColor(e.color),
    backdrop: normalizeBackgroundBackdrop(e.backdrop),
    padding: clampNumber(e.padding, 0, BACKGROUND_PADDING_MAX, DEFAULT_BACKGROUND_PRESET.padding),
    anchor: e.anchor === 'top' ? 'top' : 'center',
    shadow: e.shadow === true,
    quality: Math.round(clampNumber(e.quality, BACKGROUND_QUALITY_MIN, BACKGROUND_QUALITY_MAX, DEFAULT_BACKGROUND_PRESET.quality)),
  };
}

/**
 * THE CANONICAL STRING the hash is taken over. Written out as its own exported
 * function so that when the app and the matting service disagree about a hash,
 * the thing to diff is a string a human can read — not two digests.
 *
 * Rules, and they are the contract (AGENTS.md §9):
 *   • exactly seven keys, ALPHABETICALLY: anchor, backdrop, canvas, color,
 *     padding, quality, shadow;
 *   • no whitespace anywhere;
 *   • colour upper-cased;
 *   • `backdrop` is the storage PATH as a plain string, `""` when there is no
 *     photo backdrop — a string rather than the object so the canonical form
 *     cannot drift when the object gains a field, and `""` rather than `null`
 *     so the key is always the same shape on both sides. `fit` is excluded
 *     because there is one mode; adding a second one MUST add it here, since
 *     the two composites would look different;
 *   • padding as a JSON number with AT MOST 3 decimals, so 0.1 and 0.100 —
 *     which a form and a JSON round-trip produce interchangeably — are one
 *     preset and not two;
 *   • `id` is deliberately absent (see the type).
 *
 * The seventh key CHANGED EVERY HASH once, deliberately and exactly once: the
 * three vectors below are the post-backdrop ones, and the pre-backdrop values
 * (`7abc910f` / `c7e0869c`) are retired. Nothing had been processed under them
 * — the migration was not run and no service was deployed — so no stored
 * composite was invalidated.
 */
export function backgroundPresetCanonical(preset: BackgroundPreset): string {
  return JSON.stringify({
    anchor: preset.anchor,
    backdrop: preset.backdrop?.storagePath ?? '',
    canvas: preset.canvas,
    color: normalizeBackgroundColor(preset.color),
    padding: Number(Number(preset.padding).toFixed(3)),
    quality: preset.quality,
    shadow: preset.shadow,
  });
}

/**
 * First 8 hex characters of SHA-1 over the canonical string.
 *
 * ASYNC because `crypto.subtle` is: there is no synchronous digest in a
 * browser, and shipping a hand-rolled SHA-1 to avoid an await would be a second
 * implementation of the one thing that must match the server byte for byte.
 * 8 hex = 4 bytes; this is a cache key for "was this composite made with these
 * settings", not a security boundary.
 *
 * Returns '' when SubtleCrypto is unavailable (an insecure context, an old
 * embedded webview). The caller then treats every composite as "preset unknown"
 * rather than "preset stale", which is the safe failure: nothing is re-run
 * behind the user's back.
 */
export async function presetHash(preset: BackgroundPreset): Promise<string> {
  const canonical = backgroundPresetCanonical(preset);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return '';
  try {
    const bytes = new TextEncoder().encode(canonical);
    const digest = await subtle.digest('SHA-1', bytes);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 8);
  } catch {
    return '';
  }
}

export interface DescriptionSettings {
  /** Symbol prefixed to the SIZE / measurement lines. */
  measurementPrefix: string;
  /** Line shown above Condition (garment prep disclosure). Empty = omitted. */
  washingLine: string;
  /** Call-to-action line near the end. Empty = omitted. */
  closingLine: string;
  /** Append #hashtags built from the tags. */
  includeHashtags: boolean;
  /** Closing disclaimer lines, one per array entry. Empty array = omitted. */
  disclaimerLines: string[];
  /** The shop/reseller name written to the Shopify CSV Vendor column.
   *  Empty → App falls back to the workspace name. This is the SELLER, not
   *  the garment's brand. */
  vendorName: string;
  /** Generate a model-written selling paragraph on Regenerate (generate-prose
   *  Edge Function). Off by default — output is unchanged until enabled. */
  proseEnabled: boolean;
  /** Workspace voice notes passed to the model (e.g. "punchy streetwear
   *  voice, short sentences"). Empty = model default voice. */
  proseStyle: string;
  /** Per-marketplace price adjustments applied at CSV export time (Step 4).
   *  Ordered — the Step 4 selector shows them in this order after the built-in
   *  no-adjustment platform. EMPTY BY DEFAULT: a workspace that never opens
   *  this setting exports exactly the prices it always did. Nothing in the
   *  description engine reads it, so the golden description snapshot is
   *  untouched by its presence. */
  platformPricing: PlatformPricingRule[];
  /** The photo-background recipe (see BackgroundPreset above). Changing it
   *  affects photos processed FROM NOW ON — existing composites keep the
   *  `bg_preset` hash they were made with, which is how Step 2 can say a
   *  composite is stale rather than silently re-running a whole batch. */
  background: BackgroundPreset;
  /** The workspace's uploaded photo backdrops, at most BACKDROPS_MAX. The
   *  preset points at ONE of them by storage path; this is the shelf it is
   *  chosen from, and it is what lets the UI name a backdrop rather than print
   *  a uuid path at the seller. */
  backdrops: WorkspaceBackdrop[];
}

export const DEFAULT_DESCRIPTION_SETTINGS: DescriptionSettings = {
  measurementPrefix: '✠',
  washingLine: 'Every Garment goes through a thorough washing process before being photographed.',
  closingLine: 'BUNDLE AND SAVE!!!!!!',
  includeHashtags: true,
  vendorName: '',
  proseEnabled: false,
  proseStyle: '',
  platformPricing: [],
  background: { ...DEFAULT_BACKGROUND_PRESET },
  backdrops: [],
  disclaimerLines: [
    '* We note major imperfections—minor signs of age or wear may not be listed, adding to the vintage character.',
    '* High-quality piece, perfect for streetwear.',
    '* Ships next day.',
    '* All sales final.',
  ],
};

/** Merge a stored partial over the defaults (tolerates old/missing keys).
 *  platformPricing and background are additionally NORMALIZED rather than
 *  trusted: both are free-form JSONB, one feeds the money path and the other an
 *  image pipeline, so a malformed value is dropped here once instead of being
 *  defended against at every use. */
export function resolveDescriptionSettings(partial?: Partial<DescriptionSettings> | null): DescriptionSettings {
  const merged = { ...DEFAULT_DESCRIPTION_SETTINGS, ...(partial ?? {}) };
  return {
    ...merged,
    platformPricing: normalizePlatformRules(merged.platformPricing),
    background: normalizeBackgroundPreset(merged.background),
    backdrops: normalizeBackdropLibrary(merged.backdrops),
  };
}

/** The org's settings, defaults when unset. Fails soft to defaults if the
 *  migration hasn't been run (missing column) or anything else goes wrong. */
export async function getOrgDescriptionSettings(orgId: string): Promise<DescriptionSettings> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('description_settings')
      .eq('id', orgId)
      .maybeSingle();
    if (error) {
      log.service(`getOrgDescriptionSettings | defaults (${error.code ?? ''} ${error.message})`);
      return { ...DEFAULT_DESCRIPTION_SETTINGS };
    }
    return resolveDescriptionSettings((data?.description_settings ?? null) as Partial<DescriptionSettings> | null);
  } catch (err) {
    log.error(`getOrgDescriptionSettings | unexpected: ${String(err)}`);
    return { ...DEFAULT_DESCRIPTION_SETTINGS };
  }
}

/** Save the org's settings (admin/owner only — organizations UPDATE RLS). */
export async function saveOrgDescriptionSettings(
  orgId: string,
  settings: DescriptionSettings,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('organizations')
    .update({ description_settings: settings })
    .eq('id', orgId)
    .select('id');
  if (error) {
    log.error(`saveOrgDescriptionSettings | ${error.message}`);
    if (error.code === '42703') return { ok: false, error: 'The description settings migration has not been run yet.' };
    return { ok: false, error: error.message };
  }
  if (!data || data.length === 0) return { ok: false, error: 'You do not have permission to change workspace settings.' };
  return { ok: true };
}
