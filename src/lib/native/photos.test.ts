import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  native: { value: false },
  camera: {
    chooseFromGallery: vi.fn(),
    takePhoto: vi.fn(),
  },
}));

vi.mock('./nativePlugin', () => ({ hasNativePlugin: () => h.native.value }));
vi.mock('@capacitor/camera', () => ({ Camera: h.camera }));

import {
  pickPhotos, takePhoto, nativePhotosAvailable, mediaResultToFile, parseExifDate,
  __resetPhotosPluginForTests,
} from './photos';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 1, 2, 3]);
const fetchMock = vi.fn(async (url: string) => { void url; return new Response(new Blob([JPEG], { type: 'image/jpeg' })); });

beforeEach(() => {
  h.native.value = false;
  __resetPhotosPluginForTests();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web path', () => {
  it('resolves null so the caller falls back to <input type=file>, without loading the plugin', async () => {
    expect(nativePhotosAvailable()).toBe(false);
    expect(await pickPhotos({ limit: 5 })).toBeNull();
    expect(await takePhoto()).toBeNull();
    expect(h.camera.chooseFromGallery).not.toHaveBeenCalled();
    expect(h.camera.takePhoto).not.toHaveBeenCalled();
  });
});

describe('parseExifDate', () => {
  it('reads the EXIF local-time format and rejects junk', () => {
    expect(parseExifDate('2026:03:04 05:06:07')).toBe(new Date(2026, 2, 4, 5, 6, 7).getTime());
    expect(parseExifDate('2026-03-04T05:06:07')).toBe(new Date(2026, 2, 4, 5, 6, 7).getTime());
    expect(parseExifDate('yesterday')).toBeNull();
    expect(parseExifDate(42)).toBeNull();
  });
});

describe('native path', () => {
  beforeEach(() => { h.native.value = true; });

  it('picks with multiple selection, the limit and metadata, and returns Files', async () => {
    h.camera.chooseFromGallery.mockResolvedValueOnce({
      results: [
        {
          type: 0, saved: false,
          uri: 'file:///var/mobile/tmp/IMG_1234.JPG',
          webPath: 'capacitor://localhost/_capacitor_file_/var/mobile/tmp/IMG_1234.JPG',
          metadata: { format: 'jpeg', exif: JSON.stringify({ DateTimeOriginal: '2026:01:02 03:04:05' }) },
        },
        {
          type: 0, saved: false,
          uri: 'content://media/picker/0/42',
          webPath: 'https://localhost/_capacitor_content_/media/picker/0/42',
          metadata: { format: 'png', creationDate: '2025-12-31T10:00:00.000Z' },
        },
      ],
    });
    const files = await pickPhotos({ limit: 12 });
    expect(h.camera.chooseFromGallery).toHaveBeenCalledWith(
      expect.objectContaining({ allowMultipleSelection: true, limit: 12, includeMetadata: true }),
    );
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      'capacitor://localhost/_capacitor_file_/var/mobile/tmp/IMG_1234.JPG',
      'https://localhost/_capacitor_content_/media/picker/0/42',
    ]);
    expect(files).toHaveLength(2);
    const [a, b] = files!;
    expect(a).toBeInstanceOf(File);
    expect(a.name).toBe('IMG_1234.JPG');
    expect(a.type).toBe('image/jpeg');
    expect(a.lastModified).toBe(new Date(2026, 0, 2, 3, 4, 5).getTime());
    // No file name in a content uri: a generated one, dated by creationDate.
    const created = Date.parse('2025-12-31T10:00:00.000Z');
    expect(b.lastModified).toBe(created);
    expect(b.name).toBe(`photo-${created}-2.jpg`); // blob type wins over the reported format
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(JPEG);
  });

  it('a cancelled pick is an empty list, not null and not a throw', async () => {
    h.camera.chooseFromGallery.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { code: 'OS-PLUG-CAMR-0020' }));
    expect(await pickPhotos()).toEqual([]);
  });

  it('other pick failures propagate', async () => {
    h.camera.chooseFromGallery.mockRejectedValueOnce(new Error('Gallery permission denied'));
    await expect(pickPhotos()).rejects.toThrow('Gallery permission denied');
  });

  it('takePhoto returns one File, null on cancel', async () => {
    h.camera.takePhoto.mockResolvedValueOnce({
      type: 0, saved: false, webPath: 'https://localhost/_capacitor_file_/cache/a.jpg', metadata: { format: 'jpg' },
    });
    const f = await takePhoto();
    expect(h.camera.takePhoto).toHaveBeenCalledWith({ includeMetadata: true });
    expect(f?.name).toBe('a.jpg');
    h.camera.takePhoto.mockRejectedValueOnce(Object.assign(new Error('User cancelled photos app'), { code: 'OS-PLUG-CAMR-0006' }));
    expect(await takePhoto()).toBeNull();
  });

  it('falls back to the base64 payload when there is no path, and to now for the date', async () => {
    const b64 = btoa(String.fromCharCode(...JPEG));
    const f = await mediaResultToFile({ type: 0, saved: false, thumbnail: b64, metadata: { format: 'png' } }, 0, 1234);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(f.type).toBe('image/png');
    expect(f.name).toBe('photo-1234-1.png');
    expect(f.lastModified).toBe(1234);
    expect(new Uint8Array(await f.arrayBuffer())).toEqual(JPEG);
  });

  it('a failed read rejects', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(mediaResultToFile({ type: 0, saved: false, webPath: 'x' }, 0)).rejects.toThrow('404');
  });
});
