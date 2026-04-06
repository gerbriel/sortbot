import React, { useState, useEffect, useRef } from 'react';

/**
 * Lazy-loading image with shimmer skeleton placeholder.
 * Shows an animated shimmer until the image loads, then fades it in.
 * On error, retries up to 3 times with exponential backoff + cache-bust
 * param to recover from transient network failures (e.g. ERR_QUIC_PROTOCOL_ERROR).
 * After all retries are exhausted, shows a faded grey placeholder.
 */
const MAX_RETRIES = 3;

const LazyImg: React.FC<{
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  draggable?: boolean;
  onDoubleClick?: React.MouseEventHandler<HTMLImageElement>;
}> = ({ src, alt, className, style, draggable, onDoubleClick }) => {
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
      retryTimerRef.current = setTimeout(() => {
        // Cache-bust forces a new request, bypassing any broken QUIC connection
        const base = src.split('?')[0];
        setActiveSrc(`${base}?t=${Date.now()}`);
      }, delay);
    } else {
      setLoaded(true);
      setErrored(true);
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
        loading="lazy"
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
