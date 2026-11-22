import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import ProductDescriptionGenerator from './ProductDescriptionGenerator';
import { mount, cleanup, click } from './ui/testUtils';
import { workflowStore } from '../lib/workflowStore';
import { createSpeechRecognizer, isSpeechAvailable, type SpeechRecognizer } from '../lib/native/speech';
import type { ClothingItem } from '../App';

/**
 * Step 3 dictation wiring against lib/native/speech.ts. The adapter is mocked
 * with a hand-driven recogniser (its own behaviour is covered in
 * speech.test.ts). What is locked here: one onResult per result is batched
 * back into the per-event shape the grammar was written for, 'aborted' and
 * 'no-speech' stay silent, the restart-on-end loop keeps going while
 * recording and stops once the user has stopped, and the native restart guard
 * gives up instead of spinning.
 */

type FakeRecognizer = SpeechRecognizer & { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> };
const recognizers: FakeRecognizer[] = [];
let recognizerKind: 'web' | 'native' = 'web';

vi.mock('../lib/native/speech', () => ({
  isSpeechAvailable: vi.fn(async () => true),
  createSpeechRecognizer: vi.fn(() => {
    const r = {
      kind: recognizerKind,
      start: vi.fn(async () => { r.onStart?.(); }),
      stop: vi.fn(async () => { r.onEnd?.(); }),
      abort: vi.fn(async () => {}),
    } as unknown as FakeRecognizer;
    recognizers.push(r);
    return r;
  }),
}));

// Everything below talks to the network or is irrelevant to dictation.
vi.mock('../lib/supabase', async () => {
  const { createSupabaseMock } = await import('../lib/testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});
vi.mock('../lib/categoryPresetsService', () => ({ getCategoryPresets: vi.fn(async () => []) }));
vi.mock('../lib/productService', () => ({
  syncGroupFieldsToDatabase: vi.fn(async () => true),
  flushProductPatchKeepalive: vi.fn(() => false),
}));
vi.mock('../lib/vocabService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/vocabService')>();
  return {
    ...actual,
    fetchActiveChips: vi.fn(async () => []),
    getBrandTerms: vi.fn(async () => []),
    getAllBrandKeywordEntries: vi.fn(async () => []),
  };
});
vi.mock('./ResearchCard', () => ({ default: () => null }));
vi.mock('./ListingLabelsPicker', () => ({ default: () => null }));
vi.mock('./BrandSpelling', () => ({ default: () => null }));

const items: ClothingItem[] = [
  { id: 'a', productGroup: 'a', category: 'tees', preview: '', imageUrls: [] },
] as unknown as ClothingItem[];

async function flush() {
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
}

function current(): FakeRecognizer {
  const r = recognizers[recognizers.length - 1];
  if (!r) throw new Error('no recogniser created');
  return r;
}

function voiceDescription(): string {
  return workflowStore.getState().processedItems[0]?.voiceDescription ?? '';
}

function recordButton(container: HTMLElement): HTMLElement {
  const btn = Array.from(container.querySelectorAll('button')).find(b => /Start Recording|Stop Recording|Wait/.test(b.textContent ?? ''));
  if (!btn) throw new Error('record button not found');
  return btn;
}

async function startRecording(container: HTMLElement) {
  click(recordButton(container));
  await flush();
  // onStart re-enables the button after 1 s; the stop handler ignores clicks
  // within 1 s of that transition.
  await act(async () => { vi.advanceTimersByTime(1100); });
}

describe('ProductDescriptionGenerator dictation wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
    recognizers.length = 0;
    recognizerKind = 'web';
    workflowStore.reset();
    workflowStore.setState({ processedItems: items, sortedImages: items });
    vi.stubGlobal('alert', vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('web: uses the adapter, starts with the same options, and shows the controls', async () => {
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    expect(isSpeechAvailable).toHaveBeenCalled();
    expect(createSpeechRecognizer).toHaveBeenCalled();
    expect(container.textContent).not.toContain('Speech recognition not supported');
    await startRecording(container);
    expect(current().start).toHaveBeenCalledWith({ lang: 'en-US', continuous: true, interimResults: true });
    expect(recordButton(container).textContent).toContain('Stop Recording');
  });

  it('shows the unsupported note when isSpeechAvailable() is false', async () => {
    vi.mocked(isSpeechAvailable).mockResolvedValueOnce(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    expect(container.textContent).toContain('Speech recognition not supported');
    expect((recordButton(container) as HTMLButtonElement).disabled).toBe(true);
  });

  it('batches the results of one event: finals become one append, interim ignored', async () => {
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    await startRecording(container);
    const r = current();
    act(() => {
      // One browser onresult event = these three synchronous calls.
      r.onResult?.('brand nike', true);
      r.onResult?.('size large', true);
      r.onResult?.('colour bl', false);
    });
    // Nothing yet: the batch is handled in a microtask, once.
    expect(voiceDescription()).toBe('');
    await flush();
    const text = voiceDescription().toLowerCase();
    expect(text).toContain('brand nike');
    expect(text).toContain('size large');
    expect(text).not.toContain('colour bl');
    expect(workflowStore.getState().processedItems[0].brand).toBeTruthy();
  });

  it('an interim-only event shows as interim text and writes nothing', async () => {
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    await startRecording(container);
    act(() => { current().onResult?.('brand ni', false); });
    await flush();
    expect(voiceDescription()).toBe('');
  });

  it("ignores 'aborted' and 'no-speech', alerts on a real error", async () => {
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    await startRecording(container);
    const r = current();
    act(() => { r.onError?.('Speech recognition was stopped.', 'aborted'); });
    act(() => { r.onError?.('No speech was detected.', 'no-speech'); });
    expect(window.alert).not.toHaveBeenCalled();
    expect(recordButton(container).textContent).toContain('Stop Recording');
    act(() => { r.onError?.('Microphone access denied.', 'not-allowed'); });
    expect(window.alert).toHaveBeenCalledWith('Speech recognition error: Microphone access denied. Please allow microphone access.');
  });

  it('a rejected start() goes through the existing error handling', async () => {
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    current().start.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'not-allowed' }));
    click(recordButton(container));
    await flush();
    expect(window.alert).toHaveBeenCalledWith('Could not start speech recognition. Make sure microphone access is allowed.');
    expect(recordButton(container).textContent).toContain('Start Recording');
  });

  it('restarts on end while recording, and not after the user stopped', async () => {
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    await startRecording(container);
    const r = current();
    expect(r.start).toHaveBeenCalledTimes(1);
    act(() => { r.onEnd?.(); });             // silence timeout
    await act(async () => { vi.advanceTimersByTime(300); });
    await flush();
    expect(r.start).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(1100); });
    click(recordButton(container));          // Stop
    await flush();
    expect(r.stop).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(2000); });
    await flush();
    expect(r.start).toHaveBeenCalledTimes(2);
  });

  it("native: a session's last result (delivered just before onEnd) is applied", async () => {
    recognizerKind = 'native';
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    await startRecording(container);
    const r = current();
    act(() => {
      r.onResult?.('brand levis', false);
      r.onResult?.('brand levis', true);
      r.onEnd?.();
    });
    await flush();
    expect(voiceDescription().toLowerCase()).toContain('brand levis');
  });

  it('native: back-to-back empty sessions back off, then dictation stops', async () => {
    recognizerKind = 'native';
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    await startRecording(container);
    const r = current();
    // The first session ran over a second (startRecording waits 1.1 s), so its
    // end restarts at the normal 300 ms. Each restart's start() fires onStart,
    // and ending at once with nothing heard is a quick end: 600, 1200, 2400,
    // 4800, then the fifth quick end gives up.
    const delays = [300, 600, 1200, 2400, 4800];
    for (const d of delays) {
      act(() => { r.onEnd?.(); });
      await act(async () => { vi.advanceTimersByTime(d - 1); });
      const before = r.start.mock.calls.length;
      await act(async () => { vi.advanceTimersByTime(1); });
      await flush();
      expect(r.start.mock.calls.length).toBe(before + 1);
    }
    act(() => { r.onEnd?.(); });
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await flush();
    expect(r.start).toHaveBeenCalledTimes(1 + delays.length);
    expect(window.alert).toHaveBeenCalledWith('Speech recognition keeps stopping. Tap Start Recording to try again.');
    expect(recordButton(container).textContent).toContain('Start Recording');
  });

  it('native: a Stop pressed while start() was still pending aborts that session', async () => {
    recognizerKind = 'native';
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    await startRecording(container);
    const r = current();
    let resolveStart: () => void = () => {};
    r.start.mockImplementationOnce(() => new Promise<void>(res => { resolveStart = res; }));
    act(() => { r.onEnd?.(); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(r.start).toHaveBeenCalledTimes(2);
    // User stops while the restart is still awaiting permissions.
    await act(async () => { vi.advanceTimersByTime(1100); });
    click(recordButton(container));
    await act(async () => { resolveStart(); });
    await flush();
    expect(r.abort).toHaveBeenCalled();
  });

  it('native: start() resolving without onStart (Android, user not speaking yet) shows Stop, and Stop works', async () => {
    recognizerKind = 'native';
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    current().start.mockImplementation(async () => {}); // no onStart until speech begins
    await startRecording(container);
    expect(recordButton(container).textContent).toContain('Stop Recording');
    click(recordButton(container));
    await flush();
    expect(current().stop).toHaveBeenCalledTimes(1);
    expect(recordButton(container).textContent).toContain('Start Recording');
  });

  it('native: the quick-end backoff measures from start() resolution when onStart never came', async () => {
    recognizerKind = 'native';
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    const r = current();
    r.start.mockImplementation(async () => {});
    await startRecording(container);
    act(() => { r.onEnd?.(); });             // long first session: normal 300 ms restart
    await act(async () => { vi.advanceTimersByTime(300); });
    await flush();
    expect(r.start).toHaveBeenCalledTimes(2);
    act(() => { r.onEnd?.(); });             // ends at once, nothing heard: quick, 600 ms
    await act(async () => { vi.advanceTimersByTime(599); });
    await flush();
    expect(r.start).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(1); });
    await flush();
    expect(r.start).toHaveBeenCalledTimes(3);
  });

  it('native: unmount aborts the session, and the onEnd it triggers writes nothing', async () => {
    recognizerKind = 'native';
    const { container, unmount } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    await startRecording(container);
    const r = current();
    r.abort.mockImplementation(async () => { r.onEnd?.(); }); // the real adapter ends synchronously
    const before = workflowStore.getState().processedItems;
    unmount();
    await flush();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(r.abort).toHaveBeenCalledTimes(1);
    expect(r.start).toHaveBeenCalledTimes(1); // no restart after unmount
    expect(workflowStore.getState().processedItems).toBe(before);
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('the hint copy carries no em dash', async () => {
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    const label = Array.from(container.querySelectorAll('label')).find(l => l.textContent?.includes('field name'));
    expect(label?.textContent).toBeTruthy();
    expect(label?.textContent).not.toContain(String.fromCharCode(0x2014));
  });
});
