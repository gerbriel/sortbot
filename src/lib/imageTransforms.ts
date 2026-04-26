import type { ClothingItem } from '../App';

/**
 * Create a transformed File (JPEG) applying rotation and crop from ClothingItem.
 * crop: percent values { x,y,w,h } relative to image.
 */
export const createTransformedFile = async (item: ClothingItem): Promise<File | null> => {
  return new Promise((resolve) => {
    const src = item.preview || item.imageUrls?.[0] || '';
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const rot = (item.imageRotation || 0) % 360;
        const crop = item.crop;

        const srcW = img.naturalWidth;
        const srcH = img.naturalHeight;

        const sx = crop ? Math.round((crop.x / 100) * srcW) : 0;
        const sy = crop ? Math.round((crop.y / 100) * srcH) : 0;
        const sW = crop ? Math.round((crop.w / 100) * srcW) : srcW;
        const sH = crop ? Math.round((crop.h / 100) * srcH) : srcH;

        const radians = (rot * Math.PI) / 180;
        const cos = Math.abs(Math.cos(radians));
        const sin = Math.abs(Math.sin(radians));

        const canvasW = Math.round(sW * cos + sH * sin);
        const canvasH = Math.round(sW * sin + sH * cos);

        const canvas = document.createElement('canvas');
        canvas.width = canvasW;
        canvas.height = canvasH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);

        ctx.translate(canvasW / 2, canvasH / 2);
        ctx.rotate(radians);
        ctx.drawImage(img, sx, sy, sW, sH, -sW / 2, -sH / 2, sW, sH);

        canvas.toBlob((blob) => {
          if (!blob) return resolve(null);
          const file = new File([blob], `${item.id}-transformed.jpg`, { type: blob.type });
          resolve(file);
        }, 'image/jpeg', 0.92);
      } catch (err) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
};
