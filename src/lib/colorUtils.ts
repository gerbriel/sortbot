/**
 * colorUtils.ts
 *
 * Pixel-based color extraction for clothing product images.
 * Uses color-thief to sample dominant colors from the center crop of each
 * image in a product group, then votes across all images to return the
 * most likely primary color name.
 *
 * No secondary color is returned — that field is left to AI/voice/manual input.
 */

import { getPaletteSync } from 'colorthief';
import { COLOR_RGB_MAP } from './colorDatabase';

// ─── Color map ────────────────────────────────────────────────────────────────
// Derived from COLOR_DNA in colorDatabase.ts — single source of truth.
// Canonical names are title-cased for display; RGB comes from the first hex code.
//
// ALLOWED_COLORS controls which names color-thief is permitted to write into
// Step 3. Voice/AI detection is unaffected (uses COLOR_WORDS_LIST directly).
// To add a name here it must also exist as a key in COLOR_DNA.

const ALLOWED_COLORS = new Set([
  'red', 'crimson', 'burgundy',
  'denim', 'navy', 'royal blue', 'carolina blue', 'teal', 'cyan', 'light blue',
  'green', 'forest green', 'olive', 'sage', 'neon green', 'mint',
  'yellow', 'gold', 'mustard', 'cream',
  'orange', 'coral', 'salmon', 'neon orange',
  'maroon', 'purple', 'lavender', 'pink', 'hot pink', 'mauve', 'peach',
  'brown', 'beige', 'tan', 'caramel',
  'gray', 'black', 'charcoal', 'heather gray', 'taupe',
  'white',
]);

interface ColorEntry {
  name: string;
  rgb: [number, number, number];
}

const COLOR_MAP: ColorEntry[] = COLOR_RGB_MAP
  .filter(entry => ALLOWED_COLORS.has(entry.name))
  .map(entry => ({
    name: entry.name.replace(/\b\w/g, c => c.toUpperCase()), // title case
    rgb: entry.rgb,
  }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Euclidean distance in RGB space, perceptually weighted (green > red > blue). */
function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt(
    2 * Math.pow(a[0] - b[0], 2) +   // red
    4 * Math.pow(a[1] - b[1], 2) +   // green — most perceptually significant
    1 * Math.pow(a[2] - b[2], 2)     // blue
  );
}

/** Convert RGB to HSB (hue, saturation 0-100, brightness 0-255). */
function rgbToHsb(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const v = max;
  const s = max === 0 ? 0 : (delta / max) * 100;
  let h = 0;
  if (delta !== 0) {
    if (max === r)      h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else                h = 60 * ((r - g) / delta + 4);
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

/**
 * Returns true if the RGB value is a neutral (near-white, near-black, or grey)
 * that is likely to be a background rather than the garment itself.
 * Threshold kept tight (s < 12) so desaturated clothing colors like olive,
 * sage, tan, beige, and charcoal are NOT mistakenly filtered out.
 */
function isNeutral(rgb: [number, number, number]): boolean {
  const { s, v } = rgbToHsb(rgb[0], rgb[1], rgb[2]);
  // Only discard truly achromatic pixels at extreme brightness (white/off-white
  // backgrounds or near-black shadows) — not muted clothing colors.
  return s < 12 && (v > 210 || v < 30);
}

/**
 * Returns true if the RGB looks like a common busy-background color:
 * the tan/cream of newspaper print, or the brown/green of wooden/ivy backdrops.
 * These are filtered ONLY when we have enough non-background colors in the pool
 * already — so we don't accidentally discard a tan garment.
 */
function isLikelyBackground(rgb: [number, number, number]): boolean {
  const [r, g, b] = rgb;
  const { s, v } = rgbToHsb(r, g, b);

  // Newspaper / parchment — warm off-white/beige (high V, low-mid S, warm hue)
  if (v > 160 && s > 5 && s < 28 && r > g && r > b) return true;

  // Wooden lattice / brown backdrop — mid-dark warm brown
  if (v > 50 && v < 160 && s > 15 && s < 55 && r > g && r > b && r - b > 20) return true;

  return false;
}

/**
 * Build multiple narrow canvas strips from the center column of the image.
 * Clothing hangs in the center-horizontal band of the frame, so we take
 * the middle 40% of width but sample across the full usable height in slices.
 * This captures the garment body without picking up background at the edges.
 */
function getCenterStripCanvases(img: HTMLImageElement): HTMLCanvasElement[] {
  const srcW = img.naturalWidth  || img.width;
  const srcH = img.naturalHeight || img.height;

  // Horizontal: center 40% of image width (avoids left/right background)
  const stripW = Math.floor(srcW * 0.40);
  const stripX = Math.floor((srcW - stripW) / 2);

  // Vertical: skip top 10% (hanger/hook) and bottom 5% (floor/table edge)
  // then divide the remaining height into 3 equal slices
  const usableTop    = Math.floor(srcH * 0.10);
  const usableBottom = Math.floor(srcH * 0.95);
  const usableH      = usableBottom - usableTop;
  const sliceH       = Math.floor(usableH / 3);

  const canvases: HTMLCanvasElement[] = [];

  for (let i = 0; i < 3; i++) {
    const srcY = usableTop + i * sliceH;
    const canvas = document.createElement('canvas');
    canvas.width  = stripW;
    canvas.height = sliceH;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, stripX, srcY, stripW, sliceH, 0, 0, stripW, sliceH);
      canvases.push(canvas);
    }
  }

  return canvases;
}

/** Nearest-neighbor lookup: map an RGB value to the closest color name. */
function rgbToColorName(rgb: [number, number, number]): string {
  let best = COLOR_MAP[0];
  let bestDist = Infinity;
  for (const entry of COLOR_MAP) {
    const d = rgbDistance(rgb, entry.rgb);
    if (d < bestDist) { bestDist = d; best = entry; }
  }
  return best.name;
}

/**
 * Load a URL as an HTMLImageElement with crossOrigin="anonymous".
 * Resolves when the image is fully loaded, rejects on error.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${url}`));
    img.src = url;
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Sample all images in a group, pool the RGB palette entries, cluster by
 * proximity, and return the dominant color name.
 *
 * Returns null if no usable color is found (all images failed / all pixels
 * were neutral backgrounds).
 */
export async function extractGroupPrimaryColor(imageUrls: string[]): Promise<string | null> {
  if (!imageUrls.length) return null;

  const pool: [number, number, number][] = [];

  await Promise.allSettled(
    imageUrls.map(async (url) => {
      try {
        const img     = await loadImage(url);
        const strips  = getCenterStripCanvases(img);
        for (const canvas of strips) {
          // colorCount 8 gives more data points for better color voting
          const palette = getPaletteSync(canvas, { colorCount: 8 });
          if (!palette) continue;
          for (const color of palette) {
            const rgb: [number, number, number] = color.array();
            if (!isNeutral(rgb)) pool.push(rgb);
          }
        }
      } catch {
        // silently skip failed images — other images in the group still contribute
      }
    })
  );

  if (!pool.length) return null;

  // ── Filter likely background colors if we have enough signal ─────────────
  // Only remove background-looking colors when the pool is large enough that
  // we won't accidentally discard the only color data we have.
  const filtered = pool.length >= 6 ? pool.filter(rgb => !isLikelyBackground(rgb)) : pool;
  const workingPool = filtered.length > 0 ? filtered : pool;

  // ── Cluster by proximity ───────────────────────────────────────────────────
  // Simple greedy clustering: each entry joins the nearest existing cluster
  // centroid if within distance 55, otherwise starts a new cluster.
  // Wider radius (55 vs old 40) means perceptually-similar shades (e.g. crimson
  // vs burgundy, navy vs royal blue) cluster together for a stronger vote.
  const CLUSTER_RADIUS = 55;

  type Cluster = { entries: [number, number, number][]; centroid: [number, number, number] };
  const clusters: Cluster[] = [];

  for (const rgb of workingPool) {
    let nearest: Cluster | null = null;
    let nearestDist = Infinity;

    for (const cluster of clusters) {
      const d = rgbDistance(rgb, cluster.centroid);
      if (d < nearestDist) { nearestDist = d; nearest = cluster; }
    }

    if (nearest && nearestDist <= CLUSTER_RADIUS) {
      nearest.entries.push(rgb);
      // Recalculate centroid as running mean
      const n = nearest.entries.length;
      nearest.centroid = [
        Math.round(nearest.entries.reduce((s, c) => s + c[0], 0) / n),
        Math.round(nearest.entries.reduce((s, c) => s + c[1], 0) / n),
        Math.round(nearest.entries.reduce((s, c) => s + c[2], 0) / n),
      ];
    } else {
      clusters.push({ entries: [rgb], centroid: [...rgb] as [number, number, number] });
    }
  }

  if (!clusters.length) return null;

  // Largest cluster wins
  clusters.sort((a, b) => b.entries.length - a.entries.length);
  return rgbToColorName(clusters[0].centroid);
}
