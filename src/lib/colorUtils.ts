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

interface ColorEntry {
  name: string;
  rgb: [number, number, number];
}

const COLOR_MAP: ColorEntry[] = COLOR_RGB_MAP.map(entry => ({
  name: entry.name.replace(/\b\w/g, c => c.toUpperCase()), // title case
  rgb: entry.rgb,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Euclidean distance in RGB space. */
function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt(
    Math.pow(a[0] - b[0], 2) +
    Math.pow(a[1] - b[1], 2) +
    Math.pow(a[2] - b[2], 2)
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
 */
function isNeutral(rgb: [number, number, number]): boolean {
  const { s, v } = rgbToHsb(rgb[0], rgb[1], rgb[2]);
  // Low saturation AND extreme brightness = background noise
  return s < 30 && (v > 200 || v < 40);
}

/**
 * Draw the center `cropFraction` of an image onto an off-screen canvas and return it.
 * The original image is never modified. The canvas only lives in memory.
 */
function getCenterCropCanvas(img: HTMLImageElement, cropFraction = 0.5): HTMLCanvasElement {
  const srcW = img.naturalWidth  || img.width;
  const srcH = img.naturalHeight || img.height;
  const cropW = Math.floor(srcW * cropFraction);
  const cropH = Math.floor(srcH * cropFraction);
  const offsetX = Math.floor((srcW - cropW) / 2);
  const offsetY = Math.floor((srcH - cropH) / 2);

  const canvas = document.createElement('canvas');
  canvas.width  = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(img, offsetX, offsetY, cropW, cropH, 0, 0, cropW, cropH);
  return canvas;
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
        const img    = await loadImage(url);
        const canvas = getCenterCropCanvas(img, 0.5);
        // getPaletteSync is the v3 sync browser API — returns Color[] | null
        const palette = getPaletteSync(canvas, { colorCount: 5 });
        if (!palette) return;
        for (const color of palette) {
          const rgb: [number, number, number] = color.array();
          if (!isNeutral(rgb)) pool.push(rgb);
        }
      } catch {
        // silently skip failed images — other images in the group still contribute
      }
    })
  );

  if (!pool.length) return null;

  // ── Cluster by proximity ───────────────────────────────────────────────────
  // Simple greedy clustering: each entry joins the nearest existing cluster
  // centroid if within distance 40, otherwise starts a new cluster.
  const CLUSTER_RADIUS = 40;

  type Cluster = { entries: [number, number, number][]; centroid: [number, number, number] };
  const clusters: Cluster[] = [];

  for (const rgb of pool) {
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
