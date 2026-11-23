import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, SwitchCamera, X } from 'lucide-react';
import { Badge, Button, ConfirmAction, Dialog, IconButton, Spinner } from './ui';
import './CameraCapture.css';

/**
 * CameraCapture: Step 1's in-app camera. A seller takes one or many photos in
 * a row without leaving the app, then hands them all to the same intake the
 * file inputs use (ImageUpload's processFiles).
 *
 * HOW A SHOT BECOMES A FILE. Each shutter press draws the current video frame
 * onto a fresh canvas and encodes it with toBlob('image/jpeg', 0.92). A canvas
 * JPEG has no EXIF block, so the capture moment is written into
 * File.lastModified, which is exactly the fallback ImageUpload's getCapturedAt
 * reads after exifr finds no DateTimeOriginal. Two presses in the same
 * millisecond still get strictly increasing times, so the grid order is the
 * press order. Names are camera-<yyyymmdd-hhmmss>-<n>.jpg in local time.
 *
 * MEMORY. State holds only the File and a SMALL thumbnail object URL (a
 * second, roughly 192px canvas drawn from the same frame), so the strip never
 * decodes thirty 12-megapixel JPEGs. Every thumbnail URL is revoked on remove
 * and on unmount (which is every close: the parent mounts this only while open).
 *
 * CAMERA LIFECYCLE, the rule BarcodeScannerView already follows: a stream
 * that is not stopped keeps the camera light on. Every exit path stops every
 * TRACK (never just the video): Use, Cancel, close, unmount, the page going
 * hidden (restarted when it comes back), a flip (the old stream stops before
 * the new one is requested), a track that ends on its own, and any error. A
 * getUserMedia call that resolves after the dialog closed, or after a newer
 * request, stops its stream at once (requestIdRef).
 *
 * FALLBACK. When getUserMedia is missing or fails, the dialog says why and
 * offers "Use the system camera instead", which calls onUseSystemCamera. The
 * parent decides what that is: takePhoto() from lib/native/photos.ts inside
 * the native shell, the capture="environment" input on the web.
 */

const JPEG_QUALITY = 0.92;
/** Long side of the strip thumbnail, in device pixels. */
const THUMB_PX = 192;
/** Target cell width for the strip, used only to count columns. */
const STRIP_CELL_PX = 64;
const STRIP_GAP_PX = 8;
const STRIP_ROWS = 2;

type ErrorReason = 'unavailable' | 'denied' | 'notfound' | 'busy' | 'interrupted' | 'failed';

type CameraStatus =
  | { kind: 'starting' }
  | { kind: 'live' }
  | { kind: 'error'; reason: ErrorReason };

interface Shot {
  seq: number;
  file: File;
  /** Object URL of the small thumbnail, not the full-size File. */
  url: string;
}

type StreamTarget = { deviceId: string } | { facing: 'environment' | 'user' };

export interface CameraCaptureProps {
  /** "Use N photos": the shots in capture order. The parent closes the dialog. */
  onUse: (files: File[]) => void;
  /** Cancel or close (after the discard confirm when shots exist). */
  onCancel: () => void;
  /** The fallback button. The parent opens the native or system camera. */
  onUseSystemCamera: () => void;
  /** Blocks "Use" while an upload is already running (the intake would drop it). */
  busy?: boolean;
}

function hasGetUserMedia(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function cameraFileName(at: number, seq: number): string {
  const d = new Date(at);
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `camera-${date}-${time}-${seq}.jpg`;
}

function classifyError(err: unknown): ErrorReason {
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'notfound';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'failed';
}

const ERROR_COPY: Record<ErrorReason, string> = {
  unavailable: 'This browser cannot show a live camera here.',
  denied: 'Camera access is turned off. Allow it in your settings, or use the system camera.',
  notfound: 'No camera was found on this device.',
  busy: 'The camera is in use by another app. Close it and try again.',
  interrupted: 'The camera stopped.',
  failed: 'The camera could not start.',
};

function stopAll(stream: MediaStream | null) {
  stream?.getTracks().forEach(t => t.stop());
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export default function CameraCapture({ onUse, onCancel, onUseSystemCamera, busy = false }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const shutterRef = useRef<HTMLButtonElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Bumped by every start and every stop; a resolve with an old id is stale. */
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const deviceIdRef = useRef<string | null>(null);
  const facingRef = useRef<'environment' | 'user'>('environment');
  const deviceIdsRef = useRef<string[]>([]);
  /** Every thumbnail URL still alive, so unmount can free them all. */
  const urlsRef = useRef<Set<string>>(new Set());
  const seqRef = useRef(0);
  const lastAtRef = useRef(0);
  const hiddenStopRef = useRef(false);
  const shotCountRef = useRef(0);
  const onCancelRef = useRef(onCancel);

  const [status, setStatus] = useState<CameraStatus>(() =>
    hasGetUserMedia() ? { kind: 'starting' } : { kind: 'error', reason: 'unavailable' });
  const [shots, setShots] = useState<Shot[]>([]);
  const [cameraCount, setCameraCount] = useState(0);
  const [mirrored, setMirrored] = useState(false);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [cols, setCols] = useState(4);

  useEffect(() => { shotCountRef.current = shots.length; }, [shots.length]);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);

  /** Invalidates any pending request and stops every track. No state writes,
   *  so it is safe in cleanups. */
  const stopStream = useCallback(() => {
    requestIdRef.current += 1;
    stopAll(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause?.();
      video.srcObject = null;
    }
  }, []);

  const startStream = useCallback(async (target: StreamTarget = { facing: 'environment' }) => {
    const id = ++requestIdRef.current;
    stopAll(streamRef.current);
    streamRef.current = null;
    if (!hasGetUserMedia()) return;   // the initial state already says 'unavailable'
    const md = navigator.mediaDevices;
    const isStale = () => id !== requestIdRef.current || !mountedRef.current;
    let stream: MediaStream | null = null;
    try {
      const size = { width: { ideal: 3024 }, height: { ideal: 4032 } };
      stream = await md.getUserMedia({
        video: 'deviceId' in target
          ? { deviceId: { exact: target.deviceId }, ...size }
          : { facingMode: target.facing, ...size },
        audio: false,
      });
      if (isStale()) { stopAll(stream); return; }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() ?? {};
      deviceIdRef.current = settings.deviceId ?? null;
      if (settings.facingMode === 'user' || settings.facingMode === 'environment') facingRef.current = settings.facingMode;
      else if ('facing' in target) facingRef.current = target.facing;
      const live = stream;
      track?.addEventListener?.('ended', () => {
        // The OS took the camera (a call, another app). Release everything.
        if (streamRef.current !== live || !mountedRef.current) return;
        stopStream();
        setStatus({ kind: 'error', reason: 'interrupted' });
      });
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play?.()?.catch?.(() => { /* autoplay refused; muted + playsInline normally avoid it */ });
      }
      if (isStale()) return;
      setMirrored(facingRef.current === 'user');
      setStatus({ kind: 'live' });
      if (typeof md.enumerateDevices === 'function') {
        const devices = await md.enumerateDevices();
        if (isStale()) return;
        const ids = devices.filter(d => d.kind === 'videoinput').map(d => d.deviceId);
        deviceIdsRef.current = ids;
        setCameraCount(ids.length);
      }
    } catch (err) {
      if (stream && streamRef.current !== stream) stopAll(stream);
      if (isStale()) return;
      stopStream();
      setStatus({ kind: 'error', reason: classifyError(err) });
    }
  }, [stopStream]);

  // Acquire on open; on unmount stop every track and free every thumbnail URL.
  useEffect(() => {
    mountedRef.current = true;
    const urls = urlsRef.current;
    void startStream();
    return () => {
      mountedRef.current = false;
      stopStream();
      urls.forEach(u => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, [startStream, stopStream]);

  // Page hidden (app switcher, lock screen, another tab): release the camera,
  // and take it back when the page is visible again.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (!streamRef.current) return;
        hiddenStopRef.current = true;
        stopStream();
        setStatus({ kind: 'starting' });
      } else if (hiddenStopRef.current) {
        hiddenStopRef.current = false;
        const deviceId = deviceIdRef.current;
        void startStream(deviceId ? { deviceId } : { facing: facingRef.current });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [startStream, stopStream]);

  // Columns in the strip, so two rows can be counted. The observer fires once
  // on observe, which is the initial measurement.
  useEffect(() => {
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setCols(Math.max(1, Math.floor((width + STRIP_GAP_PX) / (STRIP_CELL_PX + STRIP_GAP_PX))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleShutter = () => {
    const video = videoRef.current;
    if (status.kind !== 'live' || !video) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;   // no frame yet

    const full = document.createElement('canvas');
    full.width = w;
    full.height = h;
    const ctx = full.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    const scale = Math.min(1, THUMB_PX / Math.max(w, h));
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(w * scale));
    thumb.height = Math.max(1, Math.round(h * scale));
    thumb.getContext('2d')?.drawImage(video, 0, 0, thumb.width, thumb.height);

    const seq = ++seqRef.current;
    const at = Math.max(Date.now(), lastAtRef.current + 1);
    lastAtRef.current = at;
    setFlashKey(k => k + 1);

    full.toBlob(blob => {
      // Release the full-size backing store as soon as the bytes exist.
      full.width = 0;
      full.height = 0;
      if (!blob || !mountedRef.current) return;
      const file = new File([blob], cameraFileName(at, seq), { type: 'image/jpeg', lastModified: at });
      thumb.toBlob(small => {
        thumb.width = 0;
        thumb.height = 0;
        if (!mountedRef.current) return;
        const url = URL.createObjectURL(small ?? file);
        urlsRef.current.add(url);
        setShots(prev => [...prev, { seq, file, url }].sort((a, b) => a.seq - b.seq));
      }, 'image/jpeg', 0.7);
    }, 'image/jpeg', JPEG_QUALITY);
  };

  const removeShot = (seq: number) => {
    const shot = shots.find(s => s.seq === seq);
    if (!shot) return;
    URL.revokeObjectURL(shot.url);
    urlsRef.current.delete(shot.url);
    setShots(prev => prev.filter(s => s.seq !== seq));
  };

  const handleFlip = () => {
    const ids = deviceIdsRef.current.filter(Boolean);
    const unique = new Set(ids).size === ids.length && ids.length > 1;
    setStatus({ kind: 'starting' });
    if (unique) {
      const i = deviceIdRef.current ? ids.indexOf(deviceIdRef.current) : -1;
      void startStream({ deviceId: ids[(i + 1) % ids.length] });
    } else {
      // Device ids hidden (no permission label yet): flip by facing instead.
      void startStream({ facing: facingRef.current === 'environment' ? 'user' : 'environment' });
    }
  };

  const handleRetry = () => {
    setStatus({ kind: 'starting' });
    const deviceId = deviceIdRef.current;
    void startStream(deviceId ? { deviceId } : { facing: facingRef.current });
  };

  const discardAndClose = useCallback(() => {
    stopStream();
    onCancelRef.current();
  }, [stopStream]);

  // Escape and the header close: ask once when shots would be lost. Stable,
  // so the Dialog's open effect (and its focus move) does not re-run per shot.
  const requestClose = useCallback(() => {
    if (shotCountRef.current > 0) setConfirmArmed(true);
    else discardAndClose();
  }, [discardAndClose]);

  const handleUse = () => {
    if (shots.length === 0 || busy) return;
    stopStream();
    onUse(shots.map(s => s.file));
  };

  const handleSystemCamera = () => {
    stopStream();
    onUseSystemCamera();
  };

  const count = shots.length;
  const capacity = cols * STRIP_ROWS;
  const overflow = !expanded && count > capacity;
  const visible = overflow ? shots.slice(count - (capacity - 1)) : shots;
  const hiddenCount = count - visible.length;
  const live = status.kind === 'live';

  return (
    <Dialog
      open
      onClose={requestClose}
      title="Take photos"
      titleIcon={<Camera size={16} aria-hidden="true" />}
      size="xl"
      className="camcap"
      closeOnOverlayClick={false}
      initialFocusRef={shutterRef}
      footer={(
        <>
          {count > 0 ? (
            <ConfirmAction
              label="Cancel"
              prompt={`Discard ${plural(count, 'photo')}?`}
              confirmLabel="Discard"
              cancelLabel="Keep"
              size="md"
              armed={confirmArmed}
              onArmedChange={setConfirmArmed}
              onConfirm={discardAndClose}
              className="camcap__cancel"
            />
          ) : (
            <Button onClick={discardAndClose}>Cancel</Button>
          )}
          <Button variant="primary" onClick={handleUse} disabled={count === 0 || busy}>
            {count === 0 ? 'Use photos' : `Use ${plural(count, 'photo')}`}
          </Button>
        </>
      )}
    >
      <div className="camcap__stage">
        <video
          ref={videoRef}
          className={`camcap__video${mirrored ? ' camcap__video--mirrored' : ''}`}
          autoPlay
          muted
          playsInline
          aria-label="Camera preview"
        />
        {flashKey > 0 && <div key={flashKey} className="camcap__flash" aria-hidden="true" />}

        {status.kind === 'starting' && (
          <div className="camcap__overlay" role="status">
            <Spinner decorative />
            <span>Starting the camera</span>
          </div>
        )}

        {status.kind === 'error' && (
          <div className="camcap__overlay camcap__overlay--error" role="alert">
            <CameraOff size={28} aria-hidden="true" />
            <p className="camcap__error-text">{ERROR_COPY[status.reason]}</p>
            <div className="camcap__error-actions">
              <Button variant="primary" icon={<Camera size={16} />} onClick={handleSystemCamera}>
                Use the system camera instead
              </Button>
              {status.reason !== 'unavailable' && status.reason !== 'notfound' && (
                <Button onClick={handleRetry}>Try again</Button>
              )}
            </div>
          </div>
        )}

        <Badge live size="md" className="camcap__count">{plural(count, 'photo')}</Badge>
      </div>

      <div
        ref={stripRef}
        className={`camcap__strip${expanded ? ' camcap__strip--expanded' : ''}`}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        aria-label="Photos taken"
      >
        {overflow && (
          <button type="button" className="camcap__more" onClick={() => setExpanded(true)}>
            +{hiddenCount} more
          </button>
        )}
        {visible.map(s => (
          <div key={s.seq} className="camcap__thumb">
            <img src={s.url} alt={`Photo ${s.seq}`} decoding="async" />
            <IconButton
              label={`Remove photo ${s.seq}`}
              icon={<span className="camcap__remove-dot"><X size={12} /></span>}
              size="sm"
              className="camcap__remove"
              onClick={() => removeShot(s.seq)}
            />
          </div>
        ))}
        {expanded && count > capacity && (
          <button type="button" className="camcap__more" onClick={() => setExpanded(false)}>
            Show fewer
          </button>
        )}
      </div>

      <div className="camcap__controls">
        <span className="camcap__controls-side" />
        <button
          ref={shutterRef}
          type="button"
          className="camcap__shutter"
          aria-label="Take photo"
          aria-disabled={!live}
          onClick={handleShutter}
        />
        <span className="camcap__controls-side camcap__controls-side--end">
          {cameraCount > 1 && (
            <IconButton
              label="Switch camera"
              icon={<SwitchCamera size={20} />}
              variant="secondary"
              size="lg"
              onClick={handleFlip}
              disabled={status.kind === 'starting'}
            />
          )}
        </span>
      </div>
    </Dialog>
  );
}
