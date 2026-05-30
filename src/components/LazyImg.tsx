import React, { useState, useEffect, useRef } from 'react';
import { log } from '../lib/debugLogger';
import { supabase } from '../lib/supabase';

/**
 * Lazy-loading image with shimmer skeleton placeholder.
 * Shows an animated shimmer until the image loads, then fades it in.
 * On error, retries up to 3 times with exponential backoff + cache-bust
 * param to recover from transient network failures (e.g. ERR_QUIC_PROTOCOL_ERROR).
 * After all retries are exhausted, shows a faded grey placeholder AND deletes
 * the orphaned product_images DB row so the broken image never reappears.
 */
const MAX_RETRIES = 3;

const LazyImg: React.FC<{
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  draggable?: boolean;
  loading?: 'lazy' | 'eager';
  onDoubleClick?: React.MouseEventHandler<HTMLImageElement>;
}> = ({ src, alt, className, style, draggable, loading = 'lazy', onDoubleClick }) => {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [activeSrc, setActiveSrc] = useState(src);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoaded(false);
    setErrored(false);
    setActiveSrc(src);
    retryCountRef.current = 0;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }, [src]);

  // Clean up retry timer on unmount
  useEffect(() => () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); }, []);

  const handleError = () => {
    if (retryCountRef.current < MAX_RETRIES) {
      const attempt = retryCountRef.current + 1;
      retryCountRef.current = attempt;
      // Exponential backoff: 500ms, 1500ms, 4500ms
      const delay = 500 * Math.pow(3, attempt - 1);
      log.img(`load error → retry ${attempt}/${MAX_RETRIES} in ${delay}ms | src=${src.split('/').pop()}`);
      retryTimerRef.current = setTimeout(() => {
        // Cache-bust forces a new request, bypassing any broken QUIC connection
        const base = src.split('?')[0];
        setActiveSrc(`${base}?t=${Date.now()}`);
      }, delay);
    } else {
      log.img(`load failed after ${MAX_RETRIES} retries | src=${src.split('/').pop()}`);
      setLoaded(true);
      setErrored(true);
      // Delete the orphaned product_images row so this broken URL doesn't
      // resurrect itself on next page load.
      const STORAGE_PREFIX = '/storage/v1/object/public/product-images/';
      const base = src.split('?')[0];
      const idx = base.indexOf(STORAGE_PREFIX);
      if (idx !== -1) {
        const storagePath = base.slice(idx + STORAGE_PREFIX.length);
        supabase.from('product_images').delete().eq('storage_path', storagePath).then(({ error }) => {
          if (error) {
            console.warn('[img] failed to delete orphaned product_images row:', storagePath, error.message);
          } else {
            console.log('[img] 🗑️ deleted orphaned product_images row:', storagePath);
          }
        });
      }
    }
  };

  if (!src) return <div className="lazy-skeleton lazy-skeleton--error" aria-hidden="true" />;

  return (
    <>
      {!loaded && !errored && (
        <div className="lazy-skeleton" aria-hidden="true" />
      )}
      {errored && (
        <div className="lazy-skeleton lazy-skeleton--error" aria-hidden="true" />
      )}
      <img
        src={activeSrc}
        alt={alt}
        className={`lazy-img${loaded ? ' loaded' : ''}${className ? ` ${className}` : ''}`}
        loading={loading}
        decoding="async"
        draggable={draggable}
        style={errored ? { display: 'none' } : style}
        onLoad={() => setLoaded(true)}
        onError={handleError}
        onDoubleClick={onDoubleClick}
      />
    </>
  );
};

export default LazyImg;
