import React, { useState, useEffect } from 'react';

/**
 * Lazy-loading image with shimmer skeleton placeholder.
 * Shows an animated shimmer until the image loads, then fades it in.
 * On error, shows a faded grey placeholder instead of a broken icon.
 */
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

  useEffect(() => {
    setLoaded(false);
    setErrored(false);
  }, [src]);

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
        src={src}
        alt={alt}
        className={`lazy-img${loaded ? ' loaded' : ''}${className ? ` ${className}` : ''}`}
        loading="lazy"
        draggable={draggable}
        style={errored ? { display: 'none' } : style}
        onLoad={() => setLoaded(true)}
        onError={() => { setLoaded(true); setErrored(true); }}
        onDoubleClick={onDoubleClick}
      />
    </>
  );
};

export default LazyImg;
