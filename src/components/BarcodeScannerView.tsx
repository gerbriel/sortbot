import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera, CameraOff, Search, Keyboard, Loader2, AlertTriangle, PackageSearch,
} from 'lucide-react';
import { findProductBySku, labelSwatch, type ScannedProduct, type ListingLabel } from '../lib/labelsService';
import { publicImageUrl } from '../lib/storageUrls';
import { baseSize } from '../lib/csvExport';
import './BarcodeScannerView.css';

/**
 * BarcodeScannerView — point a phone at a shelf label and get the listing.
 *
 * THREE WAYS IN, because a stock room has three kinds of hardware and the one
 * you have is the one that must work:
 *   1. The phone camera, via the browser's own `BarcodeDetector`. No library,
 *      no WASM, no vendor — CLAUDE.md §9. Chrome and Edge on Android and
 *      desktop have it; Safari and Firefox do not, and that is fine, because…
 *   2. …a USB/Bluetooth scanner is just a keyboard: it types the code and
 *      presses Enter. The "scan here" field captures that verbatim.
 *   3. Typing the SKU by hand, for the label that got scuffed.
 *
 * WHY NO POLYFILL: the alternative to BarcodeDetector is shipping a ~500 KB
 * WASM decoder to every user so that the minority on Safari can use the camera,
 * when option 2 already covers them with hardware they own. When the API is
 * missing we say so plainly and point at the other two inputs.
 *
 * CAMERA LIFECYCLE is the part that bites: a `getUserMedia` stream that is not
 * stopped keeps the phone's camera light on after navigation. Every exit path
 * — stop button, unmount, an error mid-stream — goes through `stopCamera`, and
 * the ref holding the stream is read in a cleanup, never during render.
 */

/** The subset of the BarcodeDetector API we use. It is not in lib.dom yet. */
interface DetectedBarcode { rawValue: string; format: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function getDetectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

/** How often to sample a frame. ~6/s reads instantly to a human and leaves the
 *  main thread alone; every-frame detection makes a mid-range phone hot. */
const SCAN_INTERVAL_MS = 160;

type Status =
  | { kind: 'idle' }
  | { kind: 'searching'; sku: string }
  | { kind: 'found'; product: ScannedProduct; labels: ListingLabel[] }
  | { kind: 'not_found'; tried: string[] }
  | { kind: 'error'; message: string };

export interface BarcodeScannerViewProps {
  /** Open this listing in Step 3. Supplied by App; without it the result card
   *  is informational only. */
  onOpenListing?: (productId: string) => void;
}

export default function BarcodeScannerView({ onOpenListing }: BarcodeScannerViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  /** Guards against the same code firing a lookup on every sampled frame. */
  const lastHitRef = useRef<string>('');
  /** Read inside async callbacks so a lookup that resolves after unmount
   *  cannot setState. */
  const mountedRef = useRef(true);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [history, setHistory] = useState<string[]>([]);

  const detectorSupported = getDetectorCtor() !== null;

  const stopCamera = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // Stopping every track is what actually turns the camera light off; pausing
    // the <video> alone does not.
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  const lookup = useCallback(async (raw: string) => {
    const sku = raw.trim();
    if (!sku) return;
    setStatus({ kind: 'searching', sku });
    const res = await findProductBySku(sku);
    if (!mountedRef.current) return;
    if (res.status === 'found') {
      setStatus({ kind: 'found', product: res.product, labels: res.labels });
      setHistory(prev => [res.product.sku || sku, ...prev.filter(h => h !== (res.product.sku || sku))].slice(0, 8));
    } else if (res.status === 'not_found') {
      setStatus({ kind: 'not_found', tried: res.tried });
    } else if (res.status === 'unavailable') {
      setStatus({ kind: 'error', message: 'Scanning needs the listing_labels migration to be run first.' });
    } else {
      setStatus({ kind: 'error', message: res.error });
    }
  }, []);

  const startCamera = useCallback(async () => {
    const Ctor = getDetectorCtor();
    if (!Ctor) {
      setCameraError('This browser has no built-in barcode reader. Use a USB scanner or type the SKU below.');
      return;
    }
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The rear camera is the one pointed at the shelf. `ideal` rather than
        // `exact` so a laptop with only a front camera still works.
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      detectorRef.current = new Ctor({ formats: ['code_128'] });
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => { /* autoplay blocked — the poster frame is enough to prompt a tap */ });
      }
      setCameraOn(true);
      lastHitRef.current = '';

      timerRef.current = window.setInterval(() => {
        const v = videoRef.current;
        const detector = detectorRef.current;
        if (!v || !detector || v.readyState < 2) return;
        detector.detect(v).then(codes => {
          if (!mountedRef.current || codes.length === 0) return;
          const value = codes[0].rawValue?.trim();
          // A held-still label produces a hit every frame; only the first is a
          // scan, the rest are the same scan.
          if (!value || value === lastHitRef.current) return;
          lastHitRef.current = value;
          void lookup(value);
        }).catch(() => { /* a transient decode failure is the normal case between reads */ });
      }, SCAN_INTERVAL_MS);
    } catch (err) {
      const name = (err as { name?: string })?.name ?? '';
      setCameraError(
        name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow it in your browser settings, or use a USB scanner / type the SKU.'
          : name === 'NotFoundError'
            ? 'No camera found on this device. Use a USB scanner or type the SKU.'
            : 'Could not start the camera. Use a USB scanner or type the SKU.',
      );
      stopCamera();
    }
  }, [lookup, stopCamera]);

  // Unmount: flip the mounted flag first so in-flight lookups go quiet, then
  // release the camera. Navigating away with the light still on is the bug
  // this exists to prevent.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, [stopCamera]);

  const submitManual = (value: string) => {
    const v = value.trim();
    if (!v) return;
    setManual('');
    void lookup(v);
  };

  const product = status.kind === 'found' ? status.product : null;
  const thumb = product?.storage_path ? publicImageUrl(product.storage_path) : '';

  return (
    <div className="bsv">
      {/* ── Camera ─────────────────────────────────────────────────────── */}
      <section className="bsv-panel">
        <h2 className="bsv-panel-title"><Camera size={15} aria-hidden="true" /> Camera</h2>

        {!detectorSupported && (
          <p className="bsv-warn">
            <AlertTriangle size={13} aria-hidden="true" />
            This browser has no built-in barcode reader (Chrome and Edge do). A USB scanner
            works anywhere — it types the code into the box below.
          </p>
        )}

        <div className={`bsv-video-wrap${cameraOn ? ' bsv-video-wrap--on' : ''}`}>
          {/* muted + playsInline are what let a phone play this without a
              fullscreen takeover; the stream has no audio track anyway. */}
          <video ref={videoRef} className="bsv-video" muted playsInline />
          {!cameraOn && (
            <div className="bsv-video-placeholder">
              <Camera size={26} aria-hidden="true" />
              <span>Camera off</span>
            </div>
          )}
          {cameraOn && <div className="bsv-reticle" aria-hidden="true" />}
        </div>

        <div className="bsv-actions">
          {cameraOn ? (
            <button type="button" className="bsv-btn" onClick={stopCamera}>
              <CameraOff size={14} /> Stop camera
            </button>
          ) : (
            <button
              type="button"
              className="bsv-btn bsv-btn--primary"
              onClick={() => void startCamera()}
              disabled={!detectorSupported}
            >
              <Camera size={14} /> Start camera
            </button>
          )}
        </div>

        {cameraError && <p className="bsv-warn" role="alert"><AlertTriangle size={13} /> {cameraError}</p>}
      </section>

      {/* ── Keyboard / scanner input ───────────────────────────────────── */}
      <section className="bsv-panel">
        <h2 className="bsv-panel-title"><Keyboard size={15} aria-hidden="true" /> Scanner or keyboard</h2>
        <p className="bsv-help">
          A USB or Bluetooth scanner behaves like a keyboard: click the box, scan, and it
          submits itself. You can also type a SKU.
        </p>
        <form
          className="bsv-form"
          onSubmit={(e) => { e.preventDefault(); submitManual(manual); }}
        >
          <input
            className="bsv-input"
            value={manual}
            placeholder="ACD-7H2K9M"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="SKU"
            onChange={(e) => setManual(e.target.value)}
          />
          <button type="submit" className="bsv-btn bsv-btn--primary" disabled={!manual.trim()}>
            <Search size={14} /> Find
          </button>
        </form>

        {history.length > 0 && (
          <div className="bsv-history">
            <span className="bsv-history-label">Recent</span>
            {history.map(h => (
              <button key={h} type="button" className="bsv-history-chip" onClick={() => void lookup(h)}>
                {h}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── Result ─────────────────────────────────────────────────────── */}
      <section className="bsv-panel bsv-result-panel">
        <h2 className="bsv-panel-title"><PackageSearch size={15} aria-hidden="true" /> Result</h2>

        {status.kind === 'idle' && (
          <p className="bsv-help">Scan or enter a SKU and the listing appears here.</p>
        )}

        {status.kind === 'searching' && (
          <p className="bsv-help"><Loader2 size={13} className="bsv-spin" /> Looking up {status.sku}…</p>
        )}

        {status.kind === 'not_found' && (
          <p className="bsv-warn" role="status">
            <AlertTriangle size={13} aria-hidden="true" />
            No listing in this workspace has the SKU {status.tried.map(t => `"${t}"`).join(' or ')}.
          </p>
        )}

        {status.kind === 'error' && (
          <p className="bsv-warn" role="alert"><AlertTriangle size={13} /> {status.message}</p>
        )}

        {status.kind === 'found' && product && (
          <div className="bsv-card">
            <div className="bsv-card-thumb">
              {thumb
                ? <img src={thumb} alt="" loading="lazy" decoding="async" />
                : <span className="bsv-card-nothumb"><PackageSearch size={20} aria-hidden="true" /></span>}
            </div>
            <div className="bsv-card-body">
              <h3 className="bsv-card-title">
                {product.seo_title || product.title || 'Untitled listing'}
              </h3>
              <div className="bsv-card-meta">
                {product.price != null && Number(product.price) > 0 && (
                  <span className="bsv-pill bsv-pill--price">${Number(product.price).toFixed(2)}</span>
                )}
                {product.size && <span className="bsv-pill">{baseSize(product.size)}</span>}
                {product.sku && <span className="bsv-pill bsv-pill--sku">{product.sku}</span>}
              </div>
              {status.labels.length > 0 && (
                <div className="bsv-card-labels">
                  {status.labels.map(l => {
                    const sw = labelSwatch(l.color);
                    return (
                      <span key={l.id} className="bsv-pill" style={{ background: sw.bg, color: sw.fg }}>
                        {l.name}
                      </span>
                    );
                  })}
                </div>
              )}
              {onOpenListing && (
                <button
                  type="button"
                  className="bsv-btn bsv-btn--primary bsv-card-open"
                  onClick={() => onOpenListing(product.id)}
                >
                  Open in Step 3
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
