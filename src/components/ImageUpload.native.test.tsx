import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import ImageUpload from './ImageUpload';
import { mount, cleanup, click } from './ui/testUtils';
import { nativePhotosAvailable, pickPhotos, takePhoto } from '../lib/native/photos';

/**
 * Step 1's "Take photos" / "Choose from library" in the native app. The
 * adapter (lib/native/photos.ts) is mocked; its own behaviour is covered in
 * photos.test.ts. What is locked here is the wiring: the web path clicks the
 * hidden input synchronously, exactly as before; native Files enter the same
 * processFiles intake; a cancel does nothing.
 *
 * The test Files are text/plain on purpose: processFiles keeps only image/*,
 * so the run finishes at once with onImagesUploaded([]) and never reaches the
 * compress/upload stages. onUploadStart (the first thing processFiles does)
 * proves the intake was reached.
 */

vi.mock('../lib/native/photos', () => ({
  nativePhotosAvailable: vi.fn(() => false),
  pickPhotos: vi.fn(async () => null),
  takePhoto: vi.fn(async () => null),
}));

async function flush() {
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
}

function buttonByText(container: HTMLElement, text: string): HTMLElement {
  const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(text));
  if (!btn) throw new Error(`button "${text}" not found`);
  return btn;
}

function setup() {
  const onImagesUploaded = vi.fn();
  const onUploadStart = vi.fn();
  const onToast = vi.fn();
  const { container } = mount(
    <ImageUpload onImagesUploaded={onImagesUploaded} userId="u1" onUploadStart={onUploadStart} onToast={onToast} />,
  );
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  const cameraInput = inputs.find(i => i.getAttribute('capture') === 'environment');
  const libraryInput = inputs.find(i => !i.hasAttribute('capture') && !i.hasAttribute('webkitdirectory') && i.accept === 'image/*' && i.style.display === 'none');
  if (!cameraInput || !libraryInput) throw new Error('hidden inputs not found');
  const cameraClick = vi.spyOn(cameraInput, 'click').mockImplementation(() => {});
  const libraryClick = vi.spyOn(libraryInput, 'click').mockImplementation(() => {});
  return { container, onImagesUploaded, onUploadStart, onToast, cameraClick, libraryClick };
}

const fakeFile = (name: string) => new File(['x'], name, { type: 'text/plain', lastModified: 1_700_000_000_000 });

describe('ImageUpload phone capture buttons', () => {
  beforeEach(() => {
    vi.mocked(nativePhotosAvailable).mockReturnValue(false);
    vi.mocked(pickPhotos).mockReset().mockResolvedValue(null);
    vi.mocked(takePhoto).mockReset().mockResolvedValue(null);
  });
  afterEach(() => cleanup());

  it('web: keeps the capture="environment" input and clicks it synchronously', () => {
    const s = setup();
    click(buttonByText(s.container, 'Take photos'));
    expect(s.cameraClick).toHaveBeenCalledTimes(1);   // no await before the click
    expect(takePhoto).not.toHaveBeenCalled();
    expect(s.onUploadStart).not.toHaveBeenCalled();
  });

  it('web: "Choose from library" clicks the library input and never calls the plugin', () => {
    const s = setup();
    click(buttonByText(s.container, 'Choose from library'));
    expect(s.libraryClick).toHaveBeenCalledTimes(1);
    expect(pickPhotos).not.toHaveBeenCalled();
  });

  it('native: the picker is used and its Files enter the processFiles intake', async () => {
    vi.mocked(nativePhotosAvailable).mockReturnValue(true);
    vi.mocked(pickPhotos).mockResolvedValue([fakeFile('IMG_1.JPG'), fakeFile('IMG_2.JPG')]);
    const s = setup();
    click(buttonByText(s.container, 'Choose from library'));
    await flush();
    expect(pickPhotos).toHaveBeenCalledWith({ limit: 0 });
    expect(s.libraryClick).not.toHaveBeenCalled();
    expect(s.onUploadStart).toHaveBeenCalledTimes(1);
    await flush();
    expect(s.onImagesUploaded).toHaveBeenCalledWith([]);
  });

  it('native: takePhoto feeds its one File into the same intake', async () => {
    vi.mocked(nativePhotosAvailable).mockReturnValue(true);
    vi.mocked(takePhoto).mockResolvedValue(fakeFile('photo.jpg'));
    const s = setup();
    click(buttonByText(s.container, 'Take photos'));
    await flush();
    expect(takePhoto).toHaveBeenCalledTimes(1);
    expect(s.cameraClick).not.toHaveBeenCalled();
    expect(s.onUploadStart).toHaveBeenCalledTimes(1);
  });

  it('native: a cancelled pick ([]) or shot (null) does nothing', async () => {
    vi.mocked(nativePhotosAvailable).mockReturnValue(true);
    vi.mocked(pickPhotos).mockResolvedValue([]);
    vi.mocked(takePhoto).mockResolvedValue(null);
    const s = setup();
    click(buttonByText(s.container, 'Choose from library'));
    click(buttonByText(s.container, 'Take photos'));
    await flush();
    expect(s.onUploadStart).not.toHaveBeenCalled();
    expect(s.libraryClick).not.toHaveBeenCalled();
    expect(s.cameraClick).not.toHaveBeenCalled();
    expect(s.onToast).not.toHaveBeenCalled();
  });

  it('native: pickPhotos returning null falls back to the web input', async () => {
    vi.mocked(nativePhotosAvailable).mockReturnValue(true);
    vi.mocked(pickPhotos).mockResolvedValue(null);
    const s = setup();
    click(buttonByText(s.container, 'Choose from library'));
    await flush();
    expect(s.libraryClick).toHaveBeenCalledTimes(1);
    expect(s.onUploadStart).not.toHaveBeenCalled();
  });

  it('native: a plugin failure is reported, not thrown', async () => {
    vi.mocked(nativePhotosAvailable).mockReturnValue(true);
    vi.mocked(pickPhotos).mockRejectedValue(new Error('boom'));
    const s = setup();
    click(buttonByText(s.container, 'Choose from library'));
    await flush();
    expect(s.onToast).toHaveBeenCalledWith('Could not open your photo library. Please try again.');
    expect(s.onUploadStart).not.toHaveBeenCalled();
  });
});
