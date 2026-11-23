import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import CameraCapture from './CameraCapture';
import ImageUpload from './ImageUpload';
import { mount, cleanup, click, keyDown, one } from './ui/testUtils';

/**
 * Step 1's in-app camera. getUserMedia, the <video> element, the canvas and
 * object URLs are all mocked: happy-dom has no camera and no 2D context. What
 * is locked here is the contract the brief asked for: the environment camera
 * is requested, a shot is a JPEG File with a capture-time lastModified, the
 * strip frees its URLs, Use hands Files over in capture order, a discard asks
 * first, every exit stops every TRACK, and a refused camera offers the system
 * camera.
 */

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  kind: string;
  getSettings: () => MediaTrackSettings;
  addEventListener: ReturnType<typeof vi.fn>;
}

let tracks: FakeTrack[] = [];
let getUserMedia: ReturnType<typeof vi.fn>;
let enumerateDevices: ReturnType<typeof vi.fn>;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let urlCounter = 0;

function fakeStream(deviceId = 'cam-back', facingMode = 'environment'): MediaStream {
  const track: FakeTrack = {
    stop: vi.fn(),
    kind: 'video',
    getSettings: () => ({ deviceId, facingMode }),
    addEventListener: vi.fn(),
  };
  tracks.push(track);
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value });
}

function cameras(n: number) {
  return Array.from({ length: n }, (_, i) => ({ kind: 'videoinput', deviceId: i === 0 ? 'cam-back' : `cam-${i}`, label: '', groupId: '' }));
}

async function flush() {
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
}

function buttonWithText(root: ParentNode, text: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(x => x.textContent?.trim() === text);
  if (!b) throw new Error(`button "${text}" not found`);
  return b;
}

const shutter = () => one(document, 'button[aria-label="Take photo"]');

async function setup(props: Partial<Parameters<typeof CameraCapture>[0]> = {}) {
  const onUse = vi.fn();
  const onCancel = vi.fn();
  const onUseSystemCamera = vi.fn();
  const view = mount(<CameraCapture onUse={onUse} onCancel={onCancel} onUseSystemCamera={onUseSystemCamera} {...props} />);
  await flush();
  return { ...view, onUse, onCancel, onUseSystemCamera };
}

describe('CameraCapture', () => {
  beforeEach(() => {
    tracks = [];
    urlCounter = 0;
    getUserMedia = vi.fn(async () => fakeStream());
    enumerateDevices = vi.fn(async () => cameras(1));
    setMediaDevices({ getUserMedia, enumerateDevices });

    // happy-dom's srcObject setter insists on its own MediaStream class.
    const src = new WeakMap<object, unknown>();
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      get() { return src.get(this) ?? null; },
      set(v: unknown) { src.set(this, v); },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 3024 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 4032 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback, type?: string) {
      cb(new Blob(['jpeg-bytes'], { type: type ?? 'image/png' }));
    });
    createObjectURL = vi.fn(() => `blob:thumb-${++urlCounter}`);
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens on the environment camera at full resolution, no audio', async () => {
    await setup();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'environment', width: { ideal: 3024 }, height: { ideal: 4032 } },
      audio: false,
    });
    const video = one(document, 'video') as HTMLVideoElement;
    expect(video.srcObject).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('0 photos');
  });

  it('the shutter adds a JPEG File named by capture time with lastModified at the press', async () => {
    const s = await setup();
    const before = Date.now();
    click(shutter());
    const after = Date.now();

    expect(document.querySelectorAll('.camcap__thumb')).toHaveLength(1);
    expect(document.querySelector('.camcap__count')?.textContent).toBe('1 photo');
    click(buttonWithText(document, 'Use 1 photo'));
    const [files] = s.onUse.mock.calls[0] as [File[]];
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe('image/jpeg');
    expect(files[0].name).toMatch(/^camera-\d{8}-\d{6}-1\.jpg$/);
    expect(files[0].lastModified).toBeGreaterThanOrEqual(before);
    expect(files[0].lastModified).toBeLessThanOrEqual(after + 1);
    // Encoded at 0.92 for the File (the 0.7 call is the small thumbnail).
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92);
  });

  it('remove drops the shot and revokes its thumbnail URL', async () => {
    await setup();
    click(shutter());
    click(shutter());
    expect(document.querySelectorAll('.camcap__thumb')).toHaveLength(2);
    const img = one(document, '.camcap__thumb img') as HTMLImageElement;
    const url = img.getAttribute('src');
    click(one(document, 'button[aria-label="Remove photo 1"]'));
    expect(revokeObjectURL).toHaveBeenCalledWith(url);
    expect(document.querySelectorAll('.camcap__thumb')).toHaveLength(1);
    expect(document.querySelector('.camcap__count')?.textContent).toBe('1 photo');
  });

  it('Use hands every File to the intake in capture order and stops the camera', async () => {
    const s = await setup();
    click(shutter());
    click(shutter());
    click(shutter());
    click(buttonWithText(document, 'Use 3 photos'));
    expect(s.onUse).toHaveBeenCalledTimes(1);
    const [files] = s.onUse.mock.calls[0] as [File[]];
    expect(files.map(f => f.name.replace(/^camera-\d{8}-\d{6}-/, ''))).toEqual(['1.jpg', '2.jpg', '3.jpg']);
    expect(files[0].lastModified).toBeLessThan(files[1].lastModified);
    expect(files[1].lastModified).toBeLessThan(files[2].lastModified);
    expect(tracks.every(t => t.stop.mock.calls.length > 0)).toBe(true);
  });

  it('Use is disabled with no shots, and while an upload is already running', async () => {
    const s = await setup({ busy: true });
    expect(buttonWithText(document, 'Use photos').disabled).toBe(true);
    click(shutter());
    expect(buttonWithText(document, 'Use 1 photo').disabled).toBe(true);
    expect(s.onUse).not.toHaveBeenCalled();
  });

  it('Cancel with shots asks once before discarding', async () => {
    const s = await setup();
    click(shutter());
    click(buttonWithText(document, 'Cancel'));
    expect(s.onCancel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Discard 1 photo?');
    click(buttonWithText(document, 'Discard'));
    expect(s.onCancel).toHaveBeenCalledTimes(1);
    expect(s.onUse).not.toHaveBeenCalled();
  });

  it('Escape and the close button with shots pending arm the same confirm', async () => {
    const s = await setup();
    click(shutter());
    keyDown('Escape', document.body);
    expect(s.onCancel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Discard 1 photo?');
    click(buttonWithText(document, 'Keep'));
    expect(document.body.textContent).not.toContain('Discard 1 photo?');
    click(one(document, 'button[aria-label="Close"]'));
    expect(s.onCancel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Discard 1 photo?');
  });

  it('close with no shots closes at once and stops every track', async () => {
    const s = await setup();
    expect(tracks).toHaveLength(1);
    click(one(document, 'button[aria-label="Close"]'));
    expect(s.onCancel).toHaveBeenCalledTimes(1);
    expect(tracks[0].stop).toHaveBeenCalled();
  });

  it('unmount stops every track and frees every thumbnail URL', async () => {
    const s = await setup();
    click(shutter());
    click(shutter());
    s.unmount();
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumb-1');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumb-2');
  });

  it('a page going hidden releases the camera and visible takes it back', async () => {
    await setup();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(tracks[0].stop).toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1][0]).toMatchObject({ video: { deviceId: { exact: 'cam-back' } } });
  });

  it('a stream that resolves after close is stopped at once', async () => {
    let resolve: (s: MediaStream) => void = () => {};
    getUserMedia.mockImplementation(() => new Promise<MediaStream>(r => { resolve = r; }));
    const s = mount(<CameraCapture onUse={vi.fn()} onCancel={vi.fn()} onUseSystemCamera={vi.fn()} />);
    s.unmount();
    const late = fakeStream();
    resolve(late);
    await flush();
    expect(tracks[0].stop).toHaveBeenCalled();
  });

  it('a denied camera shows the message and the system camera fallback', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const s = await setup();
    const alert = one(document, '[role="alert"]');
    expect(alert.textContent).toContain('Camera access is turned off');
    click(buttonWithText(alert, 'Use the system camera instead'));
    expect(s.onUseSystemCamera).toHaveBeenCalledTimes(1);
  });

  it('no getUserMedia at all (older webview) shows the fallback without asking', async () => {
    setMediaDevices(undefined);
    const s = await setup();
    const alert = one(document, '[role="alert"]');
    expect(alert.textContent).toContain('cannot show a live camera');
    click(buttonWithText(alert, 'Use the system camera instead'));
    expect(s.onUseSystemCamera).toHaveBeenCalledTimes(1);
  });

  it('flip renders only with two cameras and switches to the other device', async () => {
    await setup();
    expect(document.querySelector('button[aria-label="Switch camera"]')).toBeNull();
    cleanup();

    enumerateDevices.mockResolvedValue(cameras(2));
    await setup();
    const flip = one(document, 'button[aria-label="Switch camera"]');
    click(flip);
    await flush();
    expect(tracks[tracks.length - 2].stop).toHaveBeenCalled();
    expect(getUserMedia.mock.calls.at(-1)?.[0]).toMatchObject({ video: { deviceId: { exact: 'cam-1' } } });
  });
});

describe('Step 1 wiring', () => {
  beforeEach(() => {
    tracks = [];
    setMediaDevices({
      getUserMedia: vi.fn(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); }),
      enumerateDevices: vi.fn(async () => []),
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('a denied camera\'s fallback clicks the capture="environment" input', async () => {
    const { container } = mount(<ImageUpload onImagesUploaded={vi.fn()} userId="u1" />);
    const input = container.querySelector<HTMLInputElement>('input[capture="environment"]');
    if (!input) throw new Error('capture input not found');
    const inputClick = vi.spyOn(input, 'click').mockImplementation(() => {});
    click(buttonWithText(container, 'Take photos'));
    await flush();
    click(buttonWithText(document, 'Use the system camera instead'));
    expect(inputClick).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.camcap')).toBeNull();
  });
});
