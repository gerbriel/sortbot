import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDropzone } from 'react-dropzone';
import JSZip from 'jszip';
import exifr from 'exifr';
import type { ClothingItem } from '../App';
import { supabase } from '../lib/supabase';
import { log } from '../lib/debugLogger';
import './ImageUpload.css';

// ─── Compression config ───────────────────────────────────────────────────────
// Set to false to bypass compression and upload originals (for debugging).
const COMPRESS_ON_UPLOAD = true;
// Max dimension (width or height) in pixels. 4000px → 1600px drops ~10× in size.
const COMPRESS_MAX_PX = 1600;
// JPEG quality 0–1. 0.82 is visually lossless for product photos.
const COMPRESS_QUALITY = 0.82;
// Skip recompression of existing images already under this size (bytes).
const RECOMPRESS_SKIP_UNDER_BYTES = 200 * 1024; // 200 KB
// localStorage key that records which storagePaths have already been compressed.
const COMPRESSED_PATHS_KEY = 'sortbot_compressed_paths';
// ─────────────────────────────────────────────────────────────────────────────

/** Read the set of storage paths that have already been compressed. */
function getCompressedPaths(): Set<string> {
  try {
    const raw = localStorage.getItem(COMPRESSED_PATHS_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

/** Persist a new path as compressed. */
function markCompressed(storagePath: string) {
  try {
    const set = getCompressedPaths();
    set.add(storagePath);
    localStorage.setItem(COMPRESSED_PATHS_KEY, JSON.stringify([...set]));
  } catch { /* ignore quota errors */ }
}

interface ImageUploadProps {
  onImagesUploaded: (items: ClothingItem[]) => void;
  userId: string;
  /** Existing items in the current batch — used to offer the recompress button. */
  existingItems?: ClothingItem[];
  /**
   * Called after a EXIF rescan with the full updated item array (only capturedAt changed).
   * Parent should replace its copy of the items with these so the sort order updates live.
   */
  onCapturedAtUpdated?: (updatedItems: ClothingItem[]) => void;
  /** Optional: fires a toast notification in the parent (App.tsx) */
  onToast?: (msg: string) => void;
}

/** Imperative handle so App.tsx can trigger folder/ZIP dialogs from its own buttons. */
export interface ImageUploadHandle {
  triggerFolder: () => void;
  triggerZip: () => void;
  isBusy: boolean; // true while uploading or extracting
}

/**
 * Read the EXIF DateTimeOriginal from a JPEG file.
 * Falls back to file.lastModified if the tag is absent or parsing fails.
 * This gives a reliable "actual shot time" even when files have been
 * copied, zipped, or AirDropped (which resets lastModified).
 */
async function getCapturedAt(file: File): Promise<number> {
  if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
    try {
      const exif = await exifr.parse(file, ['DateTimeOriginal']);
      if (exif?.DateTimeOriginal instanceof Date) {
        return exif.DateTimeOriginal.getTime();
      }
    } catch {
      // EXIF parse failure is non-fatal; fall through to lastModified
    }
  }
  return file.lastModified;
}

/**
 * Compress an image File using a canvas.
 * - Resizes so the longest side ≤ COMPRESS_MAX_PX (maintains aspect ratio).
 * - Converts to JPEG at COMPRESS_QUALITY.
 * - Preserves the original file's lastModified timestamp.
 */
async function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      const scale = Math.min(1, COMPRESS_MAX_PX / Math.max(width, height));
      const targetW = Math.round(width * scale);
      const targetH = Math.round(height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No 2d context')); return; }
      ctx.drawImage(img, 0, 0, targetW, targetH);

      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('toBlob failed')); return; }
        // Keep original name but force .jpg extension
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const compressed = new File([blob], `${baseName}.jpg`, {
          type: 'image/jpeg',
          lastModified: file.lastModified,
        });
        log.upload(
          `compressImage | ${file.name} ${(file.size/1024).toFixed(0)}KB` +
          ` → ${(compressed.size/1024).toFixed(0)}KB` +
          ` (${targetW}×${targetH})` +
          ` saved ${((1 - compressed.size/file.size)*100).toFixed(0)}%`
        );
        resolve(compressed);
      }, 'image/jpeg', COMPRESS_QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Failed to load ${file.name}`)); };
    img.src = url;
  });
}


/** Extract all image Files from a .zip, preserving lastModified from zip entry dates */
async function extractImagesFromZip(zipFile: File): Promise<File[]> {
  const zip = await JSZip.loadAsync(zipFile);
  const imageFiles: File[] = [];
  const promises: Promise<void>[] = [];

  zip.forEach((relativePath, entry) => {
    // Skip directories and hidden files (e.g. __MACOSX)
    if (entry.dir || relativePath.startsWith('__MACOSX') || relativePath.includes('/.')) return;
    const ext = relativePath.split('.').pop()?.toLowerCase() ?? '';
    if (!['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return;

    promises.push(
      entry.async('blob').then(blob => {
        const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : ext === 'png' ? 'image/png'
          : ext === 'webp' ? 'image/webp'
          : 'image/gif';
        const fileName = relativePath.split('/').pop() || relativePath;
        // Use zip entry date as lastModified so sort-by-capture-date still works
        const lastModified = entry.date ? entry.date.getTime() : Date.now();
        imageFiles.push(new File([blob], fileName, { type: mimeType, lastModified }));
      })
    );
  });

  await Promise.all(promises);
  return imageFiles.sort((a, b) => a.lastModified - b.lastModified);
}

const ImageUpload = forwardRef<ImageUploadHandle, ImageUploadProps>(({ onImagesUploaded, userId, existingItems, onCapturedAtUpdated: _onCapturedAtUpdated, onToast }, ref) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [extractingZip, setExtractingZip] = useState(false);
  // Guard against processFiles being called concurrently (React Strict Mode double-invoke,
  // rapid folder/ZIP input triggers, or simultaneous drop + input events).
  const isProcessingRef = useRef(false);

  // ── Pause / cancel refs ────────────────────────────────────────────────────
  // pausedRef  — checked between every chunk; upload loop busy-waits when true.
  // cancelledRef — set on confirmed cancel; loop breaks and discards partial items.
  // lastClickRef — timestamp of previous yarn-ball click (double-click detection).
  const pausedRef    = useRef(false);
  const cancelledRef = useRef(false);
  const lastClickRef = useRef(0);
  const [isPaused,   setIsPaused]   = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [recompressState, setRecompressState] = useState<{
    running: boolean;
    done: number;
    total: number;
    savedKB: number;
    skipped: number;
    alreadyDone: number;
    errors: string[];
  } | null>(null);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  // ── Yarn ball cursor + string trail ───────────────────────────────────────
  // The cursor becomes a ball of yarn; moving the mouse unravels a smooth
  // string trail behind it.  Trail is drawn on a <canvas> using Catmull-Rom
  // splines so every bend is smooth and round — no sharp corners.

  const yarnCanvasRef  = useRef<HTMLCanvasElement>(null);
  const animFrameRef   = useRef<number | null>(null);
  const mousePixelRef  = useRef({ x: -200, y: -200 }); // raw pixel cursor pos
  const trailPointsRef = useRef<{ x: number; y: number }[]>([]); // ring of positions
  const ballRotRef     = useRef(0);   // spinning angle of the ball graphic
  const ballSizeRef    = useRef(28);  // current rendered radius (shrinks slightly)

  // ── Stalking cat (full original behaviour) ────────────────────────────────
  interface CatState {
    left: string;
    top: string;
    bodyRot: number;
    headRot: number;
    flipped: boolean;
    speed: number;
  }
  const catBodyPosRef  = useRef({ x: 15, y: 50 });
  const prevCatPosRef  = useRef({ x: 15, y: 50 });
  const smoothCurRef   = useRef({ x: 50, y: 50 });
  const bodyRotRef     = useRef(0);
  const [cat, setCat]  = useState<CatState | null>(null);

  const [yarnCursor, setYarnCursor] = useState<{ x: number; y: number; rot: number; r: number } | null>(null);

  useEffect(() => {
    if (!isUploading) {
      setYarnCursor(null);
      setCat(null);
      trailPointsRef.current = [];
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    // Hide the real OS cursor while uploading
    document.body.style.cursor = 'none';

    // Spawn cat at a random edge, far from center
    const startX = Math.random() < 0.5 ? 5 : 95;
    const startY = 20 + Math.random() * 60;
    catBodyPosRef.current  = { x: startX, y: startY };
    prevCatPosRef.current  = { x: startX, y: startY };
    smoothCurRef.current   = {
      x: (mousePixelRef.current.x / window.innerWidth)  * 100,
      y: (mousePixelRef.current.y / window.innerHeight) * 100,
    };
    bodyRotRef.current = 0;

    const MAX_TRAIL   = 220;
    const SAMPLE_DIST = 6;

    const handleMouseMove = (e: MouseEvent) => {
      mousePixelRef.current = { x: e.clientX, y: e.clientY };
    };

    const tick = () => {
      const mx = mousePixelRef.current.x;
      const my = mousePixelRef.current.y;
      const pts = trailPointsRef.current;

      // ── Yarn trail ──────────────────────────────────────────────────────
      if (pts.length === 0) {
        pts.push({ x: mx, y: my });
      } else {
        const last = pts[pts.length - 1];
        const d = Math.hypot(mx - last.x, my - last.y);
        if (d >= SAMPLE_DIST) {
          pts.push({ x: mx, y: my });
          if (pts.length > MAX_TRAIL) pts.shift();
        }
      }

      const last2 = pts.length >= 2 ? pts[pts.length - 2] : { x: mx, y: my };
      const ballSpeed = Math.hypot(mx - last2.x, my - last2.y);
      ballRotRef.current += ballSpeed * 0.04;

      const BASE_R = 28, MIN_R = 18;
      const shrink = Math.min(pts.length / MAX_TRAIL, 1);
      ballSizeRef.current = BASE_R - (BASE_R - MIN_R) * shrink;

      const canvas = yarnCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
            canvas.width  = window.innerWidth;
            canvas.height = window.innerHeight;
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (pts.length >= 2) {
            const n = pts.length;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < n - 1; i++) {
              const mx0 = (pts[i-1].x + pts[i+1].x) / 2;
              const my0 = (pts[i-1].y + pts[i+1].y) / 2;
              const cpx = pts[i].x + (mx0 - pts[i].x) * 0.5;
              const cpy = pts[i].y + (my0 - pts[i].y) * 0.5;
              ctx.quadraticCurveTo(cpx, cpy, pts[i].x, pts[i].y);
            }
            ctx.lineTo(mx, my);
            const grad = ctx.createLinearGradient(pts[0].x, pts[0].y, mx, my);
            grad.addColorStop(0,    'rgba(180, 90, 30, 0)');
            grad.addColorStop(0.15, 'rgba(190,100, 40, 0.18)');
            grad.addColorStop(0.55, 'rgba(195,110, 45, 0.55)');
            grad.addColorStop(1,    'rgba(200,115, 50, 0.85)');
            ctx.strokeStyle = grad;
            ctx.lineWidth   = 3.5;
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';
            ctx.stroke();
            // highlight pass
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < n - 1; i++) {
              const mx0 = (pts[i-1].x + pts[i+1].x) / 2;
              const my0 = (pts[i-1].y + pts[i+1].y) / 2;
              const cpx = pts[i].x + (mx0 - pts[i].x) * 0.5;
              const cpy = pts[i].y + (my0 - pts[i].y) * 0.5;
              ctx.quadraticCurveTo(cpx, cpy, pts[i].x, pts[i].y);
            }
            ctx.lineTo(mx, my);
            const grad2 = ctx.createLinearGradient(pts[0].x, pts[0].y, mx, my);
            grad2.addColorStop(0,   'rgba(255,200,120,0)');
            grad2.addColorStop(0.4, 'rgba(255,210,140,0.1)');
            grad2.addColorStop(1,   'rgba(255,220,160,0.35)');
            ctx.strokeStyle = grad2;
            ctx.lineWidth   = 1.2;
            ctx.stroke();
          }
        }
      }

      setYarnCursor({ x: mx, y: my, rot: ballRotRef.current, r: ballSizeRef.current });

      // ── Stalking cat (viewport-percent coords) ──────────────────────────
      const rawCurPct = {
        x: (mx / window.innerWidth)  * 100,
        y: (my / window.innerHeight) * 100,
      };
      // Smoothly interpolate the cursor target (3% per frame = slow stalk)
      smoothCurRef.current.x += (rawCurPct.x - smoothCurRef.current.x) * 0.03;
      smoothCurRef.current.y += (rawCurPct.y - smoothCurRef.current.y) * 0.03;

      const cp = catBodyPosRef.current;
      const sc = smoothCurRef.current;
      const dx = sc.x - cp.x;
      const dy = sc.y - cp.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const STALK_DIST = 14; // vw — how close before it stops advancing

      if (dist > STALK_DIST + 0.5) {
        const spd = Math.min((dist - STALK_DIST) * 0.018, 0.6);
        cp.x += (dx / dist) * spd;
        cp.y += (dy / dist) * spd;
      }

      // Body rotation — direction of travel
      const mvDx = cp.x - prevCatPosRef.current.x;
      const mvDy = cp.y - prevCatPosRef.current.y;
      const mvSpeed = Math.sqrt(mvDx * mvDx + mvDy * mvDy);
      prevCatPosRef.current = { x: cp.x, y: cp.y };

      if (mvSpeed > 0.002) {
        const targetBodyRot = Math.atan2(mvDy, mvDx) * (180 / Math.PI);
        let delta = targetBodyRot - bodyRotRef.current;
        while (delta >  180) delta -= 360;
        while (delta < -180) delta += 360;
        bodyRotRef.current += delta * 0.12;
      }

      // Head rotation — always aims at raw cursor, relative to body
      const headDx = rawCurPct.x - cp.x;
      const headDy = rawCurPct.y - cp.y;
      const absHeadAngle = Math.atan2(headDy, headDx) * (180 / Math.PI);
      let relHeadAngle = absHeadAngle - bodyRotRef.current;
      while (relHeadAngle >  180) relHeadAngle -= 360;
      while (relHeadAngle < -180) relHeadAngle += 360;
      const clampedHead = Math.max(-75, Math.min(75, relHeadAngle));

      const norm = ((bodyRotRef.current % 360) + 360) % 360;
      const flipped = norm > 90 && norm < 270;

      setCat({
        left:    `${cp.x}vw`,
        top:     `${cp.y}vh`,
        bodyRot: bodyRotRef.current,
        headRot: clampedHead,
        flipped,
        speed:   Math.min(mvSpeed * 60, 1),
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };

    window.addEventListener('mousemove', handleMouseMove);
    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      document.body.style.cursor = '';
      trailPointsRef.current = [];
    };
  }, [isUploading]);

  // Expose trigger methods to App.tsx so it can place the buttons in the section header
  useImperativeHandle(ref, () => ({
    triggerFolder: () => folderInputRef.current?.click(),
    triggerZip:    () => zipInputRef.current?.click(),
    isBusy: isUploading || extractingZip,
  }), [isUploading, extractingZip]);

  const processFiles = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    // Prevent concurrent uploads — drop any call that arrives while one is already running
    if (isProcessingRef.current) {
      log.upload('processFiles | SKIPPED — already in progress (double-fire guard)');
      return;
    }
    isProcessingRef.current = true;
    // Reset pause/cancel state for this new upload session
    pausedRef.current    = false;
    cancelledRef.current = false;
    setIsPaused(false);
    setIsCancelling(false);
    try {
    // Filter to images only, read EXIF DateTimeOriginal (falls back to lastModified),
    // then sort oldest-first so folder imports stay in photo order.
    const rawFiles = acceptedFiles.filter(f => f.type.startsWith('image/'));
    const fileTimestamps = await Promise.all(rawFiles.map(f => getCapturedAt(f)));
    const imageFiles = rawFiles
      .map((f, idx) => ({ file: f, capturedAt: fileTimestamps[idx] }))
      .sort((a, b) => a.capturedAt - b.capturedAt);

    setIsUploading(true);
    setUploadProgress({ done: 0, total: imageFiles.length });

    log.upload(`processFiles | files=${imageFiles.length} compress=${COMPRESS_ON_UPLOAD}`);

    const CHUNK = 10;
    const items: ClothingItem[] = [];

    for (let i = 0; i < imageFiles.length; i += CHUNK) {
      // ── Pause: busy-wait (poll every 200ms) until resumed or cancelled ──
      while (pausedRef.current && !cancelledRef.current) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      // ── Cancel: discard everything uploaded so far ──
      if (cancelledRef.current) {
        log.upload('processFiles | CANCELLED by user');
        break;
      }

      const chunk = imageFiles.slice(i, i + CHUNK);
      const results = await Promise.all(chunk.map(async ({ file, capturedAt }) => {
        const productId = crypto.randomUUID();
        // Compress before upload if enabled
        const fileToUpload = COMPRESS_ON_UPLOAD ? await compressImage(file).catch(() => file) : file;
        const uploaded = await uploadToSupabase(fileToUpload, productId);
        if (!uploaded) {
          console.warn('⚠️ Upload failed for:', file.name, '- using blob URL as fallback');
          return { id: productId, file, capturedAt, originalName: file.name, preview: URL.createObjectURL(file) };
        }
        // Mark as compressed so the "needs compression" badge never shows for fresh uploads
        if (COMPRESS_ON_UPLOAD) markCompressed(uploaded.storagePath);
        return {
          id: productId, file,
          capturedAt,
          originalName: file.name,
          preview: uploaded.preview,
          imageUrls: uploaded.imageUrls,
          storagePath: uploaded.storagePath,
        };
      }));
      items.push(...results);
      setUploadProgress({ done: Math.min(i + CHUNK, imageFiles.length), total: imageFiles.length });
    }

    setIsUploading(false);
    setUploadProgress(null);
    setIsPaused(false);
    setIsCancelling(false);
    if (!cancelledRef.current) {
      log.upload(`upload complete | success=${items.filter(i => i.storagePath).length} fallback=${items.filter(i => !i.storagePath).length} total=${items.length}`);
      onImagesUploaded(items);
    } else {
      log.upload('upload cancelled — partial items discarded');
    }
    } finally {
      isProcessingRef.current = false;
      pausedRef.current    = false;
      cancelledRef.current = false;
    }
  }, [onImagesUploaded, userId]);
  
  const uploadToSupabase = async (file: File, productId: string): Promise<{ preview: string; imageUrls: string[]; storagePath: string } | null> => {
    try {
      const fileExt = file.name.split('.').pop();
      const randomId = Math.random().toString(36).substring(2, 15);
      const fileName = `${Date.now()}-${randomId}.${fileExt}`;
      // Use permanent path so the URL stored in DB remains valid indefinitely.
      const filePath = `${userId}/${productId}/${fileName}`;

      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error('Upload error:', error);
        return null;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(data.path);

      return {
        preview: publicUrl,
        imageUrls: [publicUrl],
        storagePath: data.path
      };
    } catch (error) {
      console.error('Upload failed:', error);
      return null;
    }
  };

  /**
   * Recompress all existing images in-place in Supabase Storage.
   * - Skips paths already compressed in a previous run (tracked in localStorage).
   * - Downloads each image from its CDN URL, compresses via canvas, re-uploads
   *   to the SAME storagePath using upsert:true so the URL never changes.
   * - Skips files that are already small enough (< RECOMPRESS_SKIP_UNDER_BYTES).
   * - Records errors per image so the user can see exactly what failed.
   */
  const recompressExisting = async () => {
    const items = existingItems ?? [];
    const alreadyCompressed = getCompressedPaths();

    const candidates = items.filter(i => i.storagePath && (i.imageUrls?.[0] || i.thumbnailUrl || i.preview));
    if (candidates.length === 0) return;

    const needsWork = candidates.filter(i => !alreadyCompressed.has(i.storagePath!));
    const alreadyDoneCount = candidates.length - needsWork.length;

    if (needsWork.length === 0) {
      setRecompressState({ running: false, done: 0, total: 0, savedKB: 0, skipped: 0, alreadyDone: alreadyDoneCount, errors: [] });
      return;
    }

    setRecompressState({ running: true, done: 0, total: needsWork.length, savedKB: 0, skipped: 0, alreadyDone: alreadyDoneCount, errors: [] });
    log.upload(`recompressExisting | candidates=${candidates.length} needsWork=${needsWork.length} alreadyDone=${alreadyDoneCount}`);

    let totalSavedBytes = 0;
    let skipped = 0;
    const errors: string[] = [];
    const CHUNK = 5;

    for (let i = 0; i < needsWork.length; i += CHUNK) {
      const chunk = needsWork.slice(i, i + CHUNK);
      await Promise.all(chunk.map(async (item) => {
        const url = item.imageUrls?.[0] || item.thumbnailUrl || item.preview || '';
        if (!url || !item.storagePath) return;

        try {
          const resp = await fetch(url);
          if (!resp.ok) {
            errors.push(`Fetch failed (${resp.status}) — ${item.storagePath.split('/').pop()}`);
            skipped++;
            return;
          }
          const blob = await resp.blob();

          if (blob.size < RECOMPRESS_SKIP_UNDER_BYTES) {
            markCompressed(item.storagePath);
            skipped++;
            return;
          }

          if (blob.type === 'image/avif' && blob.size < 100 * 1024) {
            markCompressed(item.storagePath);
            skipped++;
            return;
          }

          const originalSize = blob.size;
          const originalFile = new File([blob], 'img.jpg', { type: blob.type, lastModified: Date.now() });
          const compressed = await compressImage(originalFile);

          if (compressed.size >= originalSize * 0.9) {
            markCompressed(item.storagePath);
            skipped++;
            return;
          }

          const { error } = await supabase.storage
            .from('product-images')
            .upload(item.storagePath, compressed, {
              contentType: 'image/jpeg',
              cacheControl: '3600',
              upsert: true,
            });

          if (error) {
            errors.push(`Upload error — ${item.storagePath.split('/').pop()}: ${error.message}`);
            skipped++;
            return;
          }

          markCompressed(item.storagePath);
          totalSavedBytes += originalSize - compressed.size;
        } catch (err) {
          errors.push(`Error — ${item.storagePath!.split('/').pop()}: ${err instanceof Error ? err.message : String(err)}`);
          skipped++;
        }
      }));

      setRecompressState({
        running: true,
        done: Math.min(i + CHUNK, needsWork.length),
        total: needsWork.length,
        savedKB: Math.round(totalSavedBytes / 1024),
        skipped,
        alreadyDone: alreadyDoneCount,
        errors: [...errors],
      });
    }

    setRecompressState({
      running: false,
      done: needsWork.length,
      total: needsWork.length,
      savedKB: Math.round(totalSavedBytes / 1024),
      skipped,
      alreadyDone: alreadyDoneCount,
      errors: [...errors],
    });
    log.upload(`recompressExisting done | saved=${(totalSavedBytes/1024/1024).toFixed(2)}MB skipped=${skipped} errors=${errors.length}`);

    // Fire a toast summarising the result
    const savedKB = Math.round(totalSavedBytes / 1024);
    const savedLabel = savedKB >= 1024
      ? `${(savedKB / 1024).toFixed(1)} MB saved`
      : `${savedKB} KB saved`;
    onToast?.(`✅ Compression done · ${savedLabel}${alreadyDoneCount > 0 ? ` · ${alreadyDoneCount} already compressed` : ''}${skipped > 0 ? ` · ${skipped} skipped` : ''}`);
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    // Separate zips from plain images
    const zips = acceptedFiles.filter(f => f.name.toLowerCase().endsWith('.zip'));
    const images = acceptedFiles.filter(f => !f.name.toLowerCase().endsWith('.zip'));

    if (zips.length > 0) {
      setExtractingZip(true);
      try {
        const extracted = (await Promise.all(zips.map(extractImagesFromZip))).flat();
        extracted.sort((a, b) => a.lastModified - b.lastModified);
        await processFiles([...images, ...extracted]);
      } finally {
        setExtractingZip(false);
      }
    } else {
      processFiles(images);
    }
  }, [processFiles]);

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    processFiles(files);
    e.target.value = '';
  };

  const handleZipChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setExtractingZip(true);
    try {
      const extracted = (await Promise.all(files.map(extractImagesFromZip))).flat();
      extracted.sort((a, b) => a.lastModified - b.lastModified);
      await processFiles(extracted);
    } finally {
      setExtractingZip(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp'],
      'application/zip': ['.zip'],
      'application/x-zip-compressed': ['.zip'],
    },
    multiple: true,
    disabled: isUploading
  });

  // ── Yarn ball click handler: single = pause/resume, double = cancel prompt ──
  const handleYarnClick = () => {
    const now = Date.now();
    const timeSinceLast = now - lastClickRef.current;
    lastClickRef.current = now;

    if (timeSinceLast < 350) {
      // Double-click — confirm cancel
      setIsCancelling(true);
    } else {
      // Single click — toggle pause/resume
      const nextPaused = !pausedRef.current;
      pausedRef.current = nextPaused;
      setIsPaused(nextPaused);
    }
  };

  const handleConfirmCancel = () => {
    cancelledRef.current = true;
    pausedRef.current    = false; // unblock the wait loop so it exits
    setIsCancelling(false);
    setIsPaused(false);
  };

  const handleDismissCancel = () => {
    setIsCancelling(false);
    // If we were paused before the cancel prompt, stay paused
  };

  // Full-screen yarn overlay — portalled to body so it's truly fullscreen
  const creatureOverlay = isUploading ? createPortal(
    <div className="upload-overlay">
      {/* Trail canvas — fills the whole viewport */}
      <canvas ref={yarnCanvasRef} className="yarn-trail-canvas" />

      {/* Yarn ball — sits exactly on the cursor; click to pause/resume, double-click to cancel */}
      {yarnCursor && (
        <div
          className={`yarn-ball${isPaused ? ' yarn-ball-paused' : ''}`}
          style={{
            left: yarnCursor.x,
            top:  yarnCursor.y,
            width:  yarnCursor.r * 2,
            height: yarnCursor.r * 2,
            transform: `translate(-50%, -50%) rotate(${yarnCursor.rot}deg)`,
            cursor: 'pointer',
          } as React.CSSProperties}
          onClick={handleYarnClick}
        >
          {/* Wound-line grooves drawn as SVG so they rotate with the ball */}
          <svg viewBox="0 0 56 56" className="yarn-svg">
            <ellipse cx="28" cy="28" rx="24" ry="22" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="2.5"/>
            <ellipse cx="28" cy="28" rx="18" ry="26" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2"/>
            <ellipse cx="28" cy="28" rx="26" ry="14" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5"/>
            <ellipse cx="28" cy="28" rx="10" ry="26" fill="none" stroke="rgba(120,40,0,0.18)"    strokeWidth="1.5"/>
            <ellipse cx="20" cy="18" rx="6" ry="4" fill="rgba(255,220,160,0.28)" />
          </svg>
        </div>
      )}

      {/* Stalking cat — full CSS cat, body rotates to travel direction, head aims at cursor */}
      {cat && (
        <div
          className="upload-creature"
          style={{
            left: cat.left,
            top:  cat.top,
            transform: `translate(-50%, -50%) rotate(${cat.bodyRot}deg) scaleX(${cat.flipped ? -1 : 1})`,
          } as React.CSSProperties}
        >
          <div className={`cat-side${cat.speed > 0.05 ? ' cat-walking' : ''}`}>
            <div className="cat-tail-side" />
            <div className="cat-body-side">
              <div className="cat-leg-side cat-back-leg-far" />
              <div className="cat-leg-side cat-back-leg-near" />
              <div className="cat-leg-side cat-front-leg-far" />
              <div className="cat-leg-side cat-front-leg-near" />
            </div>
            <div
              className="cat-head-side"
              style={{ transform: `rotate(${cat.headRot}deg)` } as React.CSSProperties}
            >
              <div className="cat-ear-side cat-ear-side-l" />
              <div className="cat-ear-side cat-ear-side-r" />
              <div className="cat-eye-side" />
              <div className="cat-nose-side" />
              <div className="cat-whiskers-side" />
            </div>
          </div>
        </div>
      )}

      {/* Paused indicator */}
      {isPaused && !isCancelling && (
        <div className="yarn-paused-badge">
          ⏸ Paused — click yarn to resume · double-click to cancel
        </div>
      )}

      {/* Cancel confirm dialog */}
      {isCancelling && (
        <div className="yarn-cancel-dialog">
          <p>Cancel upload?</p>
          <p className="yarn-cancel-sub">
            {uploadProgress
              ? `${uploadProgress.done} of ${uploadProgress.total} images uploaded so far will be discarded.`
              : 'All progress will be lost.'}
          </p>
          <div className="yarn-cancel-buttons">
            <button className="yarn-cancel-btn-yes" onClick={handleConfirmCancel}>Yes, cancel</button>
            <button className="yarn-cancel-btn-no"  onClick={handleDismissCancel}>Keep uploading</button>
          </div>
        </div>
      )}

      <div className="upload-overlay-label">
        {isPaused ? 'Paused' : isCancelling ? 'Cancel upload?' : `Uploading${uploadProgress ? ` ${uploadProgress.done} / ${uploadProgress.total}` : '…'}`}
      </div>
    </div>,
    document.body
  ) : null;

  return (
      <div className="image-upload-container">
        {creatureOverlay}
        {/* Hidden folder input */}
        <input
          ref={folderInputRef}
          type="file"
          style={{ display: 'none' }}
          // @ts-ignore — webkitdirectory is non-standard but works in all modern browsers
          webkitdirectory=""
          multiple
          accept="image/*"
          onChange={handleFolderChange}
        />

        {/* Hidden ZIP input */}
        <input
          ref={zipInputRef}
          type="file"
          style={{ display: 'none' }}
          accept=".zip"
          multiple
          onChange={handleZipChange}
        />

        <div 
          {...getRootProps()} 
          className={`dropzone ${isDragActive ? 'active' : ''} ${isUploading || extractingZip ? 'uploading' : ''}`}
        >
          <input {...getInputProps()} />
          <div className="dropzone-content">
            {extractingZip ? (
              <>
                <div className="spinner"></div>
                <p>Extracting ZIP… please wait</p>
              </>
            ) : isUploading ? (
              <>
                {/* Minimal dropzone content while uploading — creature lives in full-screen overlay */}
                <p style={{ color: 'var(--gray-500)', fontSize: '0.85rem', margin: 0 }}>
                  Uploading{uploadProgress ? ` ${uploadProgress.done} / ${uploadProgress.total}` : '…'}
                </p>
              </>
            ) : (
              <>
                <svg 
                  className="upload-icon" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" 
                  />
                </svg>
                {isDragActive ? (
                  <p>Drop images or a ZIP file here…</p>
                ) : (
                  <>
                    <p>Drag & drop clothing images here</p>
                    <p className="dropzone-subtext">or click to select files</p>
                    <p className="dropzone-hint">Supports: JPG, PNG, WEBP · or drop a ZIP file</p>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Recompress existing images button — shown when there are already-uploaded items */}
        {!isUploading && !extractingZip && (existingItems?.length ?? 0) > 0 && (() => {
          const compressedPaths = getCompressedPaths();
          const allCandidates = (existingItems ?? []).filter(i => i.storagePath && (i.imageUrls?.[0] || i.thumbnailUrl || i.preview));
          const needsWorkCount = allCandidates.filter(i => !compressedPaths.has(i.storagePath!)).length;

          return (
            <div style={{ marginTop: '0.75rem' }}>
              {recompressState === null ? (
                <div>
                  {/* No status badges — compression runs automatically on upload.
                      Only show the manual re-compress button when genuinely needed. */}
                  {needsWorkCount > 0 && (
                    <button
                      type="button"
                      onClick={recompressExisting}
                      title="Re-download and recompress existing images to save storage space. URLs stay the same — no re-upload needed. Each image is only compressed once."
                      style={{
                        width: '100%',
                        padding: '0.6rem 1rem',
                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: 600,
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                      }}
                    >
                      🗜️ Compress {needsWorkCount} Image{needsWorkCount !== 1 ? 's' : ''}
                    </button>
                  )}
                </div>
              ) : recompressState.running ? (
                <div style={{
                  background: 'rgba(16,185,129,0.12)',
                  border: '1px solid #10b981',
                  borderRadius: '8px',
                  padding: '0.6rem 1rem',
                  fontSize: '0.85rem',
                  color: '#065f46',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}>
                  <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />
                  Compressing… {recompressState.done}/{recompressState.total}
                  {recompressState.savedKB > 0 && ` · saved ${recompressState.savedKB >= 1024
                    ? `${(recompressState.savedKB/1024).toFixed(1)} MB`
                    : `${recompressState.savedKB} KB`} so far`}
                  {recompressState.skipped > 0 && ` · ${recompressState.skipped} skipped`}
                </div>
              ) : (
                <div style={{
                  background: 'rgba(16,185,129,0.12)',
                  border: '1px solid #10b981',
                  borderRadius: '8px',
                  padding: '0.6rem 1rem',
                  fontSize: '0.85rem',
                  color: '#065f46',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span>
                      ✅ Done! Saved{' '}
                      <strong>{recompressState.savedKB >= 1024
                        ? `${(recompressState.savedKB/1024).toFixed(1)} MB`
                        : `${recompressState.savedKB} KB`}</strong>
                      {recompressState.alreadyDone > 0 && ` · ${recompressState.alreadyDone} already compressed`}
                      {recompressState.skipped > 0 && ` · ${recompressState.skipped} too-small/skipped`}
                    </span>
                    <button
                      onClick={() => setRecompressState(null)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: '#065f46', flexShrink: 0 }}
                    >
                      ✕ dismiss
                    </button>
                  </div>
                  {/* Error list */}
                  {recompressState.errors.length > 0 && (
                    <div style={{ marginTop: '0.5rem', borderTop: '1px solid #6ee7b7', paddingTop: '0.4rem' }}>
                      <div style={{ color: '#991b1b', fontWeight: 600, fontSize: '0.78rem', marginBottom: '0.2rem' }}>
                        ⚠️ {recompressState.errors.length} error{recompressState.errors.length !== 1 ? 's' : ''}:
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.75rem', color: '#7f1d1d', lineHeight: 1.5 }}>
                        {recompressState.errors.map((e, idx) => <li key={idx}>{e}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Recompress ALL batches ─────────────────────────────────────────── */}
        {/* Button hidden — compression runs automatically on import */}
      </div>
  );
});

export default ImageUpload;
