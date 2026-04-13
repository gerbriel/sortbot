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

  // ── Upload creature horde (mouse-chasing monsters) ───────────────────────
  const CREATURE_TYPES = ['blob', 'werewolf', 'stone', 'tree', 'vampire', 'frankenstein'] as const;
  type CreatureType = typeof CREATURE_TYPES[number];

  interface CreatureAnimState {
    id: number;
    type: CreatureType;
    left: string;
    top: string;
    rotation: number;
  }

  // Shared cursor position
  const cursorPos    = useRef({ x: 50, y: 50 });
  const animFrameRef = useRef<number | null>(null);

  // Per-creature refs (arrays, indexed by creature id)
  const creaturePositions = useRef<Array<{ x: number; y: number }>>([]);
  const lagTargets        = useRef<number[]>([]);
  const lagCurrents       = useRef<number[]>([]);
  const lagTimers         = useRef<number[]>([]);

  const [creatures, setCreatures] = useState<CreatureAnimState[]>([]);

  useEffect(() => {
    if (!isUploading) {
      setCreatures([]);
      creaturePositions.current = [];
      lagTargets.current = [];
      lagCurrents.current = [];
      lagTimers.current.forEach(t => clearTimeout(t));
      lagTimers.current = [];
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    // Spawn 3–6 creatures with random types, staggered around screen center
    const count = 3 + Math.floor(Math.random() * 4); // 3..6
    const shuffled = [...CREATURE_TYPES].sort(() => Math.random() - 0.5);
    const initial: CreatureAnimState[] = Array.from({ length: count }, (_, i) => {
      // Spread start positions loosely around center (40–60 vw/vh)
      const startX = 35 + Math.random() * 30;
      const startY = 35 + Math.random() * 30;
      creaturePositions.current[i] = { x: startX, y: startY };
      const initLag = 8 + Math.random() * 18;
      lagTargets.current[i]  = initLag;
      lagCurrents.current[i] = initLag;
      return {
        id: i,
        type: shuffled[i % shuffled.length],
        left: `${startX}vw`,
        top:  `${startY}vh`,
        rotation: 0,
      };
    });
    setCreatures(initial);

    // Per-creature lag drift timers
    const LAG_MIN = 8, LAG_MAX = 24;
    const refreshLag = (i: number) => {
      lagTargets.current[i] = LAG_MIN + Math.random() * (LAG_MAX - LAG_MIN);
      lagTimers.current[i] = window.setTimeout(() => refreshLag(i), 1200 + Math.random() * 1200);
    };
    for (let i = 0; i < count; i++) refreshLag(i);

    const handleMouseMove = (e: MouseEvent) => {
      cursorPos.current = {
        x: (e.clientX / window.innerWidth)  * 100,
        y: (e.clientY / window.innerHeight) * 100,
      };
    };

    // Each creature has a tiny individual speed multiplier so they spread out
    const speedMults = Array.from({ length: count }, () => 0.75 + Math.random() * 0.55);

    const tick = () => {
      const tp = cursorPos.current;
      const updates: Pick<CreatureAnimState, 'id' | 'left' | 'top' | 'rotation'>[] = [];

      for (let i = 0; i < creaturePositions.current.length; i++) {
        // Lerp lag toward target
        lagCurrents.current[i] += (lagTargets.current[i] - lagCurrents.current[i]) * 0.008;

        const cp   = creaturePositions.current[i];
        const dx   = tp.x - cp.x;
        const dy   = tp.y - cp.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const lag  = lagCurrents.current[i];

        if (dist > lag) {
          const excess = dist - lag;
          const speed  = Math.min(excess * 0.09, 2.2) * speedMults[i];
          cp.x += (dx / dist) * speed;
          cp.y += (dy / dist) * speed;
        }

        updates.push({
          id:       i,
          left:     `${cp.x}vw`,
          top:      `${cp.y}vh`,
          rotation: Math.atan2(dy, dx) * (180 / Math.PI),
        });
      }

      setCreatures(prev =>
        prev.map(c => {
          const u = updates.find(x => x.id === c.id);
          return u ? { ...c, ...u } : c;
        })
      );

      animFrameRef.current = requestAnimationFrame(tick);
    };

    window.addEventListener('mousemove', handleMouseMove);
    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      lagTimers.current.forEach(t => clearTimeout(t));
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
    log.upload(`upload complete | success=${items.filter(i => i.storagePath).length} fallback=${items.filter(i => !i.storagePath).length} total=${items.length}`);
    onImagesUploaded(items);
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

  // Full-screen creature overlay — portalled to body so it's truly fullscreen
  const creatureOverlay = isUploading ? createPortal(
    <div className="upload-overlay">
      {creatures.map(c => (
        <div
          key={c.id}
          className={`upload-creature creature-${c.type}`}
          style={{
            left: c.left,
            top:  c.top,
            '--rotation': `${c.rotation}deg`,
          } as React.CSSProperties}
        >
          <div className="creature-body">
            <div className="creature-eyes">
              <div className="creature-eye" />
              <div className="creature-eye" />
            </div>
          </div>
          <div className="creature-legs">
            <div className="creature-leg leg-l" />
            <div className="creature-leg leg-r" />
          </div>
        </div>
      ))}
      <div className="upload-overlay-label">
        Uploading{uploadProgress ? ` ${uploadProgress.done} / ${uploadProgress.total}` : '…'}
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
