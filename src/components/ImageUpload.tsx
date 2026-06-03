import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
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
// Max dimension (width or height) in pixels.
// 2000px at 0.88 quality keeps product photos sharp enough for Shopify (which
// recommends ≥2048px) while still achieving 3-5× size reduction from a raw
// DSLR shot. Previous values (1200px / 0.75) caused visible pixelation,
// especially after a second JPEG pass during crop.
const COMPRESS_MAX_PX = 2000;
// JPEG quality 0–1. 0.88 is a good balance: visually indistinguishable from
// lossless at typical product-photo viewing sizes, ~40% smaller than 0.95.
const COMPRESS_QUALITY = 0.88;
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
  /**
   * Called after each upload chunk so the parent can progressively render
   * images as they finish rather than waiting for the full batch.
   * `newItems` contains only the items from this chunk.
   */
  onChunkReady?: (newItems: ClothingItem[]) => void;
  /**
   * Called synchronously at the very start of a new upload batch (before any
   * files are processed). Allows the parent to mint a stable batchId before
   * the first per-chunk DB write runs — ensuring products rows are created
   * with the correct batch_id from the start.
   */
  onUploadStart?: () => void;
  /**
   * Returns the current batchId — read via a ref in the parent so it's always
   * up-to-date even in the same synchronous frame that `onUploadStart` fires.
   */
  getBatchId?: () => string | null;
  /** When true, suppresses the cat + yarn ball overlay during uploads. Default false. */
  // boredMode?: boolean; // reserved for future use
  /** Called when the user toggles bored mode from within the upload overlay. */
  // onBoredModeChange?: (val: boolean) => void; // reserved for future use
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

const ImageUpload = forwardRef<ImageUploadHandle, ImageUploadProps>(({ onImagesUploaded, userId, existingItems, onCapturedAtUpdated: _onCapturedAtUpdated, onToast, onChunkReady, onUploadStart, getBatchId }, ref) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [extractingZip, setExtractingZip] = useState(false);
  // Guard against processFiles being called concurrently (React Strict Mode double-invoke,
  // rapid folder/ZIP input triggers, or simultaneous drop + input events).
  const isProcessingRef = useRef(false);

  // ── Pause / cancel refs ────────────────────────────────────────────────────
  // pausedRef  — checked between every chunk; upload loop busy-waits when true.
  // cancelledRef — set on confirmed cancel; loop breaks and discards partial items.
  const pausedRef    = useRef(false);
  const cancelledRef = useRef(false);
  const [_isPaused,     setIsPaused]     = useState(false);
  const [_isCancelling, setIsCancelling] = useState(false);
  // Files that failed all upload retries — shown in a banner with a Retry button.
  // We never silently fall back to a blob URL; if a file can't reach Storage it
  // goes here so the user can retry rather than getting a ghost item that breaks
  // after a page reload.
  const [failedUploads, setFailedUploads] = useState<{
    file: File;
    capturedAt: number;
    originalName: string;
  }[]>([]);

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

  // Expose trigger methods to App.tsx so it can place the buttons in the section header
  useImperativeHandle(ref, () => ({
    triggerFolder: () => folderInputRef.current?.click(),
    triggerZip:    () => zipInputRef.current?.click(),
    isBusy: isUploading || extractingZip,
  }), [isUploading, extractingZip]);

  const processFiles = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    // Notify parent to mint batchId synchronously before any DB writes happen.
    // This ensures the products rows we create in the per-chunk write carry the
    // correct batch_id from the very first chunk.
    onUploadStart?.();
    // Clear stale TUS fingerprints so that when the same file is re-dropped,
    // TUS always uses the fresh UUID path we just generated — not a leftover
    // partial-session path from a previous broken upload.  Without this, TUS
    // "resumes" to the old storage path but our code thinks it uploaded to the
    // new path, writing a DB row that points to a non-existent file (400s).
    Object.keys(localStorage)
      .filter(k => k.startsWith('tus::'))
      .forEach(k => localStorage.removeItem(k));
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
    // Track every storagePath we successfully write to Supabase Storage,
    // so we can delete them all if the user cancels.
    const uploadedPaths: string[] = [];

    for (let i = 0; i < imageFiles.length; i += CHUNK) {
      // ── Pause: busy-wait (poll every 200ms) until resumed or cancelled ──
      while (pausedRef.current && !cancelledRef.current) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      // ── Cancel: delete everything already in Storage, then stop ──
      if (cancelledRef.current) {
        log.upload(`processFiles | CANCELLED — deleting ${uploadedPaths.length} already-uploaded files`);
        break;
      }

      const chunk = imageFiles.slice(i, i + CHUNK);
      const chunkFailed: { file: File; capturedAt: number; originalName: string }[] = [];
      const results = (await Promise.all(chunk.map(async ({ file, capturedAt }) => {
        const productId = crypto.randomUUID();
        // Compress before upload
        const fileToUpload = COMPRESS_ON_UPLOAD
          ? await compressImage(file).catch((err) => {
              console.warn('[upload] compress failed, using original:', file.name, err);
              return file;
            })
          : file;
        console.log(
          `[upload] 📦 Compressed: ${file.name}`,
          `${(file.size / 1024).toFixed(0)} KB → ${(fileToUpload.size / 1024).toFixed(0)} KB`,
          `(saved ${((1 - fileToUpload.size / file.size) * 100).toFixed(0)}%)`,
        );

        // ── Retry loop: backoff 1 s → 2 s → 4 s → 8 s → 16 s ─────────────────
        // We attempt upload up to MAX_UPLOAD_ATTEMPTS times before giving up.
        // Each attempt tries TUS first, then falls back to the standard PUT.
        // This covers transient connectivity blips without demanding manual retries
        // from the user on every flaky-connection batch.
        const MAX_UPLOAD_ATTEMPTS = 5;
        let uploaded: Awaited<ReturnType<typeof uploadToSupabase>> = null;
        for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
          uploaded = await uploadToSupabase(fileToUpload, productId);
          if (uploaded) break;
          if (attempt < MAX_UPLOAD_ATTEMPTS) {
            const delayMs = Math.min(1000 * 2 ** (attempt - 1), 16000); // 1s,2s,4s,8s,16s
            console.warn(`[upload] ⚠️  Attempt ${attempt}/${MAX_UPLOAD_ATTEMPTS} failed for ${file.name} — retrying in ${delayMs / 1000}s…`);
            await new Promise(r => setTimeout(r, delayMs));
          }
        }
        // ─────────────────────────────────────────────────────────────────────

        if (!uploaded) {
          // All attempts exhausted — do NOT create a ghost blob item.
          // Queue for the failed-uploads banner so the user can retry.
          console.error(`[upload] ❌ All ${MAX_UPLOAD_ATTEMPTS} attempts failed for: ${file.name} — added to retry queue.`);
          chunkFailed.push({ file, capturedAt, originalName: file.name });
          return null; // excluded from items
        }

        console.log('[upload] ✅ Uploaded to Storage:', file.name, '→', uploaded.storagePath);
        if (COMPRESS_ON_UPLOAD) markCompressed(uploaded.storagePath);
        uploadedPaths.push(uploaded.storagePath);
        return {
          id: productId, file,
          capturedAt,
          originalName: file.name,
          preview: uploaded.preview,
          imageUrls: uploaded.imageUrls,
          storagePath: uploaded.storagePath,
        };
      }))).filter((r): r is NonNullable<typeof r> => r !== null);

      // Accumulate any newly-failed files into state so the banner updates live
      if (chunkFailed.length > 0) {
        setFailedUploads(prev => [...prev, ...chunkFailed]);
        console.warn(`[upload] ⚠️  ${chunkFailed.length} file(s) added to retry queue:`, chunkFailed.map(f => f.originalName));
      }
      items.push(...results);
      setUploadProgress({ done: Math.min(i + CHUNK, imageFiles.length), total: imageFiles.length });

      // ── Per-chunk DB write ─────────────────────────────────────────────────
      // Write a product_images row for every successfully-uploaded image in this
      // chunk immediately after it lands in Storage.  This means if the connection
      // drops at image 900 of 1500, the first 900 already have DB records and are
      // fully recoverable — the user doesn't lose that work.  Items that only have
      // a blob URL fallback (upload failed) are skipped; they have no storagePath.
      const chunkWithStorage = results.filter(r => r.storagePath && r.imageUrls?.[0]);
      const chunkFallback = results.filter(r => !r.storagePath);
      if (chunkFallback.length > 0) {
        console.warn(`[upload] ⚠️  ${chunkFallback.length} item(s) in this chunk are blob-only (no storagePath):`, chunkFallback.map(r => r.originalName));
        console.warn('[upload] ⚠️  MISSING: these items will not survive a reload. If this is happening frequently, check network connectivity and Supabase storage bucket permissions.');
      }
      if (chunkWithStorage.length > 0) {
        const batchId = getBatchId?.() ?? null;
        console.log(`[upload] 💾 Writing ${chunkWithStorage.length} products + product_images DB rows for chunk ${Math.floor(i / CHUNK) + 1} (batchId=${batchId ?? 'null'})...`);
        // 1) Upsert the products rows FIRST — product_images has an FK constraint
        //    on product_id that requires the parent products row to exist.
        //    ignoreDuplicates: false so that if this is a retry, batch_id is kept.
        const productRows = chunkWithStorage.map(r => ({
          id: r.id,
          user_id: userId,
          batch_id: batchId,
          status: 'Active' as const,
          product_group: r.id,
        }));
        const { error: prodErr } = await supabase.from('products').upsert(productRows, { onConflict: 'id', ignoreDuplicates: true });
        if (prodErr) {
          console.error('[upload] ❌ per-chunk products upsert error:', prodErr.message);
        } else {
          // 2) Now safe to insert product_images rows.
          //    Plain insert — each storagePath is a fresh UUID-based path so
          //    duplicates are impossible here. (storage_path has no UNIQUE
          //    constraint so upsert ON CONFLICT would fail.)
          const imgRows = chunkWithStorage.map(r => ({
            product_id: r.id,
            user_id: userId,
            image_url: r.imageUrls![0],
            storage_path: r.storagePath!,
          }));
          const { error: imgErr } = await supabase.from('product_images').insert(imgRows);
          if (imgErr) {
            console.error('[upload] ❌ per-chunk product_images insert error:', imgErr.message);
          } else {
            console.log(`[upload] ✅ DB rows written for chunk — ${chunkWithStorage.length} items saved to products + product_images`);
          }
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      // Fire immediately so the parent can show this chunk while the rest upload
      onChunkReady?.(results);
    }

    setIsUploading(false);
    setUploadProgress(null);
    setIsPaused(false);
    setIsCancelling(false);
    if (!cancelledRef.current) {
      log.upload(`upload complete | success=${items.filter(i => i.storagePath).length} fallback=${items.filter(i => !i.storagePath).length} total=${items.length}`);
      onImagesUploaded(items);
    } else {
      // Delete every file we already pushed to Supabase Storage
      if (uploadedPaths.length > 0) {
        const { error } = await supabase.storage
          .from('product-images')
          .remove(uploadedPaths);
        if (error) {
          console.error('Cancel cleanup: failed to delete uploaded files', error);
        } else {
          log.upload(`cancel cleanup | deleted ${uploadedPaths.length} files from storage`);
        }
      }
      log.upload('upload cancelled — storage cleaned up');
    }
    } finally {
      isProcessingRef.current = false;
      pausedRef.current    = false;
      cancelledRef.current = false;
    }
  }, [onImagesUploaded, userId, onUploadStart, getBatchId]);

  // Re-upload all files that failed during the last processFiles run.
  // Clears the failed list first so the banner disappears immediately, then
  // re-runs the exact same upload pipeline on just those files.
  const retryFailedUploads = useCallback(async () => {
    if (failedUploads.length === 0) return;
    const toRetry = [...failedUploads];
    setFailedUploads([]);
    console.log('[upload] 🔄 Retrying', toRetry.length, 'failed file(s)…');
    await processFiles(toRetry.map(f => f.file));
  }, [failedUploads, processFiles]);

  const uploadToSupabase = async (file: File, productId: string): Promise<{ preview: string; imageUrls: string[]; storagePath: string } | null> => {
    try {
      const fileExt = file.name.split('.').pop() || 'jpg';
      const randomId = Math.random().toString(36).substring(2, 15);
      const fileName = `${Date.now()}-${randomId}.${fileExt}`;
      // Use permanent path so the URL stored in DB remains valid indefinitely.
      const filePath = `${userId}/${productId}/${fileName}`;

      // ── Try TUS resumable upload first ────────────────────────────────────
      // TUS survives connection drops by resuming from the exact byte it stopped
      // at, rather than restarting the whole file.  This is the primary upload
      // path for all users; it's especially critical on slow/rural connections.
      try {
        console.log('[upload] 🔌 Attempting TUS resumable upload for:', filePath);
        const { tusUploadFile } = await import('../lib/tusUpload');
        const result = await tusUploadFile(file, filePath);
        console.log('[upload] ✅ TUS succeeded for:', filePath);
        return {
          preview: result.publicUrl,
          imageUrls: [result.publicUrl],
          storagePath: result.storagePath,
        };
      } catch (tusErr) {
        console.warn('[upload] ⚠️  TUS failed — falling back to standard Supabase PUT:', tusErr);
        console.warn('[upload] ⚠️  If TUS keeps failing: check that the Supabase project has TUS enabled (Dashboard → Storage → Settings)');
      }

      // ── Fallback: standard Supabase Storage PUT ────────────────────────────
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

  // Creature overlay removed — was cat + yarn ball animation during upload
  const creatureOverlay = null;

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

        {/* ── Failed uploads banner ────────────────────────────────────────── */}
        {failedUploads.length > 0 && (
          <div style={{
            marginTop: '0.75rem',
            background: 'rgba(220,38,38,0.08)',
            border: '1.5px solid #dc2626',
            borderRadius: '8px',
            padding: '0.7rem 1rem',
            fontSize: '0.85rem',
            color: '#7f1d1d',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>
                ❌ {failedUploads.length} file{failedUploads.length !== 1 ? 's' : ''} failed to upload after 5 attempts
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={retryFailedUploads}
                  disabled={isUploading}
                  style={{
                    padding: '0.35rem 0.9rem',
                    background: '#dc2626',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: isUploading ? 'not-allowed' : 'pointer',
                    opacity: isUploading ? 0.6 : 1,
                  }}
                >
                  🔄 Retry All
                </button>
                <button
                  type="button"
                  onClick={() => setFailedUploads([])}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: '#7f1d1d' }}
                >
                  ✕ dismiss
                </button>
              </div>
            </div>
            <ul style={{ margin: '0.4rem 0 0 0', paddingLeft: '1.2rem', lineHeight: 1.6, fontSize: '0.78rem', color: '#991b1b' }}>
              {failedUploads.slice(0, 10).map((f, i) => (
                <li key={i}>{f.originalName}</li>
              ))}
              {failedUploads.length > 10 && (
                <li style={{ fontStyle: 'italic' }}>…and {failedUploads.length - 10} more</li>
              )}
            </ul>
          </div>
        )}

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
