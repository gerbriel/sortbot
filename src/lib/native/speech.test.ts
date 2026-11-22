import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const listeners: Record<string, (data: unknown) => void> = {};
  const addListenerImpl = async (name: string, fn: (data: unknown) => void) => {
    listeners[name] = fn;
    return { remove: vi.fn(async () => { delete listeners[name]; }) };
  };
  const plugin = {
    available: vi.fn(async () => ({ available: true })),
    checkPermissions: vi.fn(async () => ({ speechRecognition: 'granted' })),
    requestPermissions: vi.fn(async () => ({ speechRecognition: 'granted' })),
    start: vi.fn(async (opts?: unknown) => { void opts; return {}; }),
    stop: vi.fn(async () => {}),
    addListener: vi.fn(addListenerImpl),
  };
  return { listeners, plugin, addListenerImpl, native: { value: false } };
});

vi.mock('./nativePlugin', () => ({ hasNativePlugin: () => h.native.value }));
vi.mock('@capacitor-community/speech-recognition', () => ({ SpeechRecognition: h.plugin }));

import {
  createSpeechRecognizer, isSpeechAvailable, SpeechStartError, speechErrorMessage,
  nativeStartErrorCode, NATIVE_IDLE_TIMEOUT_MS, NATIVE_SETTLE_MS,
  __resetSpeechPluginForTests,
} from './speech';

/** A stand-in for the browser's SpeechRecognition. */
class FakeWebRecognition {
  static instances: FakeWebRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() { FakeWebRecognition.instances.push(this); }
}

function results(...rs: Array<[string, boolean]>) {
  return rs.map(([t, isFinal]) => ({ isFinal, 0: { transcript: t } }));
}

beforeEach(() => {
  h.native.value = false;
  FakeWebRecognition.instances = [];
  __resetSpeechPluginForTests();
  vi.clearAllMocks();
  for (const k of Object.keys(h.listeners)) delete h.listeners[k];
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
});

describe('web path', () => {
  it('reports unavailable and rejects start when the browser has no API', async () => {
    expect(await isSpeechAvailable()).toBe(false);
    const r = createSpeechRecognizer();
    expect(r.kind).toBe('web');
    await expect(r.start()).rejects.toMatchObject({ code: 'unavailable' });
    expect(h.plugin.available).not.toHaveBeenCalled();
  });

  it('uses webkitSpeechRecognition with the PDG defaults', async () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeWebRecognition;
    expect(await isSpeechAvailable()).toBe(true);
    const r = createSpeechRecognizer();
    await r.start();
    const rec = FakeWebRecognition.instances[0];
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.lang).toBe('en-US');
    expect(rec.maxAlternatives).toBe(1);
    expect(rec.start).toHaveBeenCalledTimes(1);
  });

  it('honours the start options', async () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeWebRecognition;
    const r = createSpeechRecognizer();
    await r.start({ lang: 'es-MX', continuous: false, interimResults: false });
    const rec = FakeWebRecognition.instances[0];
    expect([rec.lang, rec.continuous, rec.interimResults]).toEqual(['es-MX', false, false]);
  });

  it('delivers one onResult per result from resultIndex, and forwards start/error/end', async () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeWebRecognition;
    const onResult = vi.fn();
    const onError = vi.fn();
    const onEnd = vi.fn();
    const onStart = vi.fn();
    const r = createSpeechRecognizer({ onResult, onError, onEnd, onStart });
    await r.start();
    const rec = FakeWebRecognition.instances[0];
    rec.onstart?.();
    rec.onresult?.({ resultIndex: 1, results: results(['old', true], ['brand nike', true], ['size', false]) });
    expect(onResult.mock.calls).toEqual([['brand nike', true], ['size', false]]);
    rec.onerror?.({ error: 'not-allowed' });
    expect(onError).toHaveBeenCalledWith(speechErrorMessage('not-allowed'), 'not-allowed');
    rec.onend?.();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('callbacks assigned after creation are used (drop-in for recognition.onX = ...)', async () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeWebRecognition;
    const r = createSpeechRecognizer();
    const onResult = vi.fn();
    r.onResult = onResult;
    await r.start();
    FakeWebRecognition.instances[0].onresult?.({ resultIndex: 0, results: results(['hi', true]) });
    expect(onResult).toHaveBeenCalledWith('hi', true);
  });

  it('reuses one instance across restarts, and wraps a synchronous start throw', async () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeWebRecognition;
    const r = createSpeechRecognizer();
    await r.start();
    await r.start();
    expect(FakeWebRecognition.instances).toHaveLength(1);
    FakeWebRecognition.instances[0].start.mockImplementationOnce(() => {
      throw Object.assign(new Error('already started'), { name: 'InvalidStateError' });
    });
    const err = await r.start().catch(e => e);
    expect(err).toBeInstanceOf(SpeechStartError);
    expect(err.code).toBe('InvalidStateError');
  });

  it('stop and abort call through', async () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeWebRecognition;
    const r = createSpeechRecognizer();
    await r.stop(); // before start: a no-op, not a throw
    await r.start();
    await r.stop();
    await r.abort();
    expect(FakeWebRecognition.instances[0].stop).toHaveBeenCalledTimes(1);
    expect(FakeWebRecognition.instances[0].abort).toHaveBeenCalledTimes(1);
  });
});

describe('native path', () => {
  beforeEach(() => {
    h.native.value = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    h.plugin.stop.mockImplementation(async () => {});
    h.plugin.addListener.mockImplementation(h.addListenerImpl);
  });

  /** stop() ends the session after the settle window; run it to completion. */
  async function stopAndSettle(r: ReturnType<typeof createSpeechRecognizer>) {
    const p = r.stop();
    await vi.advanceTimersByTimeAsync(NATIVE_SETTLE_MS);
    await p;
  }

  it('is available when the plugin says so, and never touches window', async () => {
    expect(await isSpeechAvailable()).toBe(true);
    h.plugin.available.mockResolvedValueOnce({ available: false });
    expect(await isSpeechAvailable()).toBe(false);
    h.plugin.available.mockRejectedValueOnce(new Error('not implemented'));
    expect(await isSpeechAvailable()).toBe(false);
  });

  it('starts the plugin with partial results and no popup', async () => {
    const r = createSpeechRecognizer();
    expect(r.kind).toBe('native');
    await r.start({ lang: 'en-GB' });
    expect(h.plugin.start).toHaveBeenCalledWith({ language: 'en-GB', maxResults: 1, partialResults: true, popup: false });
  });

  it('requests permission when not yet granted, and rejects not-allowed on refusal', async () => {
    h.plugin.checkPermissions.mockResolvedValueOnce({ speechRecognition: 'prompt' });
    h.plugin.requestPermissions.mockResolvedValueOnce({ speechRecognition: 'denied' });
    const r = createSpeechRecognizer();
    await expect(r.start()).rejects.toMatchObject({ code: 'not-allowed' });
    expect(h.plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(h.plugin.start).not.toHaveBeenCalled();
  });

  it('rejects unavailable when the device has no recognizer', async () => {
    h.plugin.available.mockResolvedValueOnce({ available: false });
    await expect(createSpeechRecognizer().start()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('partials are interim; the recognizer stopping delivers the last one as final, then onEnd', async () => {
    const onResult = vi.fn();
    const onEnd = vi.fn();
    const onStart = vi.fn();
    const r = createSpeechRecognizer({ onResult, onEnd, onStart });
    await r.start();
    h.listeners.listeningState({ status: 'started' });
    h.listeners.partialResults({ matches: ['brand'] });
    h.listeners.partialResults({ matches: ['brand nike'] });
    h.listeners.listeningState({ status: 'stopped' });
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls).toEqual([['brand', false], ['brand nike', false], ['brand nike', true]]);
    expect(h.listeners.partialResults).toBeUndefined(); // listeners removed
  });

  it('stop() delivers the final exactly once even if the stopped event also fires', async () => {
    const onResult = vi.fn();
    const onEnd = vi.fn();
    const r = createSpeechRecognizer({ onResult, onEnd });
    await r.start();
    h.listeners.partialResults({ matches: ['size medium'] });
    h.plugin.stop.mockImplementationOnce(async () => { h.listeners.listeningState?.({ status: 'stopped' }); });
    await stopAndSettle(r);
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1));
    expect(onResult.mock.calls.filter(c => c[1] === true)).toEqual([['size medium', true]]);
  });

  it('abort() drops the pending partial', async () => {
    const onResult = vi.fn();
    const onEnd = vi.fn();
    const r = createSpeechRecognizer({ onResult, onEnd });
    await r.start();
    h.listeners.partialResults({ matches: ['half a'] });
    await r.abort();
    expect(onResult.mock.calls.some(c => c[1] === true)).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('interimResults: false suppresses partials but keeps the final', async () => {
    const onResult = vi.fn();
    const r = createSpeechRecognizer({ onResult });
    await r.start({ interimResults: false });
    h.listeners.partialResults({ matches: ['color red'] });
    await stopAndSettle(r);
    expect(onResult.mock.calls).toEqual([['color red', true]]);
  });

  it('can start again after a session ends (the restart-on-end loop)', async () => {
    const r = createSpeechRecognizer();
    await r.start();
    await stopAndSettle(r);
    await r.start();
    expect(h.plugin.start).toHaveBeenCalledTimes(2);
  });

  it('a second start while listening rejects', async () => {
    const r = createSpeechRecognizer();
    await r.start();
    await expect(r.start()).rejects.toMatchObject({ code: 'InvalidStateError' });
  });

  it('a plugin start rejection reports onError then onEnd, after start() resolves, and cleans up', async () => {
    h.plugin.start.mockRejectedValueOnce(new Error('Microphone is already in use by another application.'));
    const order: string[] = [];
    const r = createSpeechRecognizer({
      onError: (_m, code) => order.push(`error:${code}`),
      onEnd: () => order.push('end'),
    });
    await r.start().then(() => order.push('resolved'));
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['resolved', 'error:audio-capture', 'end']);
    expect(Object.keys(h.listeners)).toEqual([]);
    // The adapter is idle again: a new session can open.
    await r.start();
    expect(h.plugin.start).toHaveBeenCalledTimes(2);
  });

  it('maps plugin start rejection messages to the browser error codes', () => {
    expect(nativeStartErrorCode('Missing permission')).toBe('not-allowed');
    expect(nativeStartErrorCode('User denied access to microphone')).toBe('not-allowed');
    expect(nativeStartErrorCode('Ongoing speech recognition')).toBe('aborted');
    expect(nativeStartErrorCode('Not available')).toBe('audio-capture');
    expect(nativeStartErrorCode('Network error')).toBe('network');
    expect(nativeStartErrorCode('No match')).toBe('no-speech');
    expect(nativeStartErrorCode('Something odd')).toBe('start-failed');
  });

  it('android: stop() ends the session even though plugin.stop() never resolves', async () => {
    h.plugin.stop.mockImplementation(() => new Promise<void>(() => {}));
    const onResult = vi.fn();
    const onEnd = vi.fn();
    const r = createSpeechRecognizer({ onResult, onEnd });
    await r.start();
    h.listeners.partialResults({ matches: ['brand gap'] });
    await stopAndSettle(r);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls.filter(c => c[1] === true)).toEqual([['brand gap', true]]);
    // Not stuck "active": the next start() works instead of InvalidStateError.
    await r.start();
    expect(h.plugin.start).toHaveBeenCalledTimes(2);
  });

  it('android: abort() ends synchronously even though plugin.stop() never resolves', async () => {
    h.plugin.stop.mockImplementation(() => new Promise<void>(() => {}));
    const onEnd = vi.fn();
    const r = createSpeechRecognizer({ onEnd });
    await r.start();
    void r.abort();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(Object.keys(h.listeners)).toEqual([]);
  });

  it('android: a stop with nothing heard still ends the session', async () => {
    h.plugin.stop.mockImplementation(() => new Promise<void>(() => {}));
    const onEnd = vi.fn();
    const r = createSpeechRecognizer({ onEnd });
    await r.start();
    await stopAndSettle(r);
    expect(onEnd).toHaveBeenCalledTimes(1);
    await expect(r.start()).resolves.toBeUndefined();
  });

  it('android: no event at all after start ends with no-speech, then onEnd (watchdog)', async () => {
    const onError = vi.fn();
    const onEnd = vi.fn();
    const r = createSpeechRecognizer({ onError, onEnd });
    await r.start();
    await vi.advanceTimersByTimeAsync(NATIVE_IDLE_TIMEOUT_MS - 1);
    expect(onEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onError).toHaveBeenCalledWith(speechErrorMessage('no-speech'), 'no-speech');
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(h.plugin.stop).toHaveBeenCalled();
    expect(Object.keys(h.listeners)).toEqual([]);
    await r.start(); // idle again
    expect(h.plugin.start).toHaveBeenCalledTimes(2);
  });

  it('android: the watchdog is reset by partials and ends quietly with what was heard', async () => {
    const onResult = vi.fn();
    const onError = vi.fn();
    const onEnd = vi.fn();
    const r = createSpeechRecognizer({ onResult, onError, onEnd });
    await r.start();
    await vi.advanceTimersByTimeAsync(NATIVE_IDLE_TIMEOUT_MS - 1000);
    h.listeners.partialResults({ matches: ['pit to pit'] });
    await vi.advanceTimersByTimeAsync(NATIVE_IDLE_TIMEOUT_MS - 1);
    expect(onEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onResult.mock.calls.at(-1)).toEqual(['pit to pit', true]);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("android: 'stopped' before onResults delivers the trailing result as the final, once", async () => {
    const onResult = vi.fn();
    const onEnd = vi.fn();
    const r = createSpeechRecognizer({ onResult, onEnd });
    await r.start();
    h.listeners.partialResults({ matches: ['size small'] });
    h.listeners.listeningState({ status: 'stopped' });
    h.listeners.listeningState({ status: 'stopped' }); // a second one is ignored
    await vi.advanceTimersByTimeAsync(100);
    h.listeners.partialResults({ matches: ['size small tall'] }); // onResults
    expect(onEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(NATIVE_SETTLE_MS);
    expect(onResult.mock.calls).toEqual([['size small', false], ['size small tall', true]]);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("an abort during the settle window after 'stopped' fires onEnd once and drops the final", async () => {
    const onResult = vi.fn();
    const onEnd = vi.fn();
    const r = createSpeechRecognizer({ onResult, onEnd });
    await r.start();
    h.listeners.partialResults({ matches: ['inseam'] });
    h.listeners.listeningState({ status: 'stopped' });
    await r.abort();
    await vi.advanceTimersByTimeAsync(NATIVE_SETTLE_MS * 2);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls.some(c => c[1] === true)).toBe(false);
  });

  it('a hanging listener removal does not block the next start()', async () => {
    const r = createSpeechRecognizer();
    h.plugin.addListener.mockImplementation(async (name: string, fn: (data: unknown) => void) => {
      h.listeners[name] = fn;
      return { remove: vi.fn(() => new Promise<void>(() => {})) };
    });
    await r.start();
    await r.abort();
    const next = r.start();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(next).resolves.toBeUndefined();
  });

  it('a late partial after abort() reaches no callback', async () => {
    const onResult = vi.fn();
    const r = createSpeechRecognizer({ onResult });
    const captured: Record<string, (d: unknown) => void> = {};
    h.plugin.addListener.mockImplementation(async (name: string, fn: (data: unknown) => void) => {
      captured[name] = fn;
      return { remove: vi.fn(async () => {}) };
    });
    await r.start();
    await r.abort();
    captured.partialResults({ matches: ['late'] });
    captured.listeningState({ status: 'stopped' });
    await vi.advanceTimersByTimeAsync(NATIVE_IDLE_TIMEOUT_MS);
    expect(onResult).not.toHaveBeenCalled();
  });
});
