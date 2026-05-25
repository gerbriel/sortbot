/**
 * tusUpload.ts
 *
 * Resumable file upload to Supabase Storage via the TUS protocol.
 *
 * Why TUS instead of the standard Supabase JS client upload?
 * The standard client sends one HTTP PUT per file.  On a rural/slow connection
 * uploading 380–1500 images, a single connectivity hiccup can abort the whole
 * batch and force a full restart.  TUS (tus.io) uploads in byte-range chunks
 * with a server-side pointer.  If the connection drops mid-file, the next
 * attempt picks up from the exact byte it stopped at — no data is re-sent
 * and no work is lost.
 *
 * Supabase Storage exposes a TUS endpoint at:
 *   <project_url>/storage/v1/upload/resumable
 *
 * Security note: we pass the user's bearer token in the Authorization header
 * so Storage RLS policies are respected identically to the standard client.
 */

import * as tus from 'tus-js-client';
import { supabase } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const BUCKET = 'product-images';

// Chunk size: 6 MB.  Supabase recommends ≥ 5 MB chunks for TUS.
// Larger chunks = fewer round-trips, but each chunk must complete before the
// next starts — 6 MB is a good balance for rural connections (it finishes in
// ~30 s at 1.5 Mbps and can be retried without much penalty).
const CHUNK_SIZE = 6 * 1024 * 1024;

export interface TusUploadResult {
  storagePath: string;
  publicUrl: string;
}

/**
 * Upload a single File to Supabase Storage using TUS resumable upload.
 *
 * @param file        The file to upload.
 * @param storagePath The destination path inside the bucket, e.g. `userId/productId/img.jpg`.
 * @param onProgress  Optional callback receiving bytes uploaded and total bytes.
 * @returns           { storagePath, publicUrl } on success, or throws on failure.
 */
export function tusUploadFile(
  file: File,
  storagePath: string,
  onProgress?: (uploaded: number, total: number) => void,
): Promise<TusUploadResult> {
  return new Promise(async (resolve, reject) => {
    // Retrieve the current session token so Storage RLS accepts this upload.
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) { reject(new Error('tusUpload: no auth session')); return; }

    const upload = new tus.Upload(file, {
      // Supabase TUS endpoint
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      // Retry indefinitely on transient errors; tus-js-client uses exponential
      // backoff capped at ~30 s between attempts automatically.
      retryDelays: [0, 1000, 3000, 5000, 10000, 30000],
      chunkSize: CHUNK_SIZE,
      headers: {
        Authorization: `Bearer ${token}`,
        'x-upsert': 'false',
      },
      // Metadata tells Supabase which bucket/object to store the file under.
      metadata: {
        bucketName: BUCKET,
        objectName: storagePath,
        contentType: file.type || 'image/jpeg',
        cacheControl: '3600',
      },
      // Use the browser's localStorage to persist the upload URL between page
      // reloads so interrupted uploads resume automatically on next visit.
      storeFingerprintForResuming: true,
      onProgress(bytesUploaded, bytesTotal) {
        onProgress?.(bytesUploaded, bytesTotal);
      },
      onSuccess() {
        const { data: { publicUrl } } = supabase.storage
          .from(BUCKET)
          .getPublicUrl(storagePath);
        resolve({ storagePath, publicUrl });
      },
      onError(err) {
        console.error('[tus] upload error for', storagePath, err);
        reject(err);
      },
    });

    // Check for a previously-started upload in localStorage and resume from
    // where it left off rather than re-uploading from byte 0.
    upload.findPreviousUploads().then(previousUploads => {
      if (previousUploads.length > 0) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }
      upload.start();
    }).catch(() => {
      // findPreviousUploads can fail if localStorage is unavailable — start fresh.
      upload.start();
    });
  });
}
