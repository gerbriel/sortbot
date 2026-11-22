/**
 * speech.ts: one dictation interface for the browser and the native app.
 *
 * WHY: Step 3 dictation (ProductDescriptionGenerator) talks to
 * `window.SpeechRecognition` / `webkitSpeechRecognition` directly. That API
 * exists in Chrome and Edge but not reliably inside the iOS or Android webview,
 * so the native app needs the `@capacitor-community/speech-recognition` plugin.
 * This module hides which one is in use behind the same small surface.
 *
 * WHICH PATH RUNS:
 *   native  when isNative() AND the plugin is linked into this native build
 *           (hasNativePlugin('SpeechRecognition')). The plugin is imported
 *           dynamically, so the web bundle does not carry it.
 *   web     everywhere else. That is the existing browser path, unchanged.
 *           The plugin is linked on both platforms (iOS through CocoaPods,
 *           Android through Gradle); hasNativePlugin() stays the guard for a
 *           build where it was removed, which then falls back here. The iOS
 *           path is untested on a device.
 *
 * API:
 *   isSpeechAvailable(): Promise<boolean>
 *   createSpeechRecognizer(callbacks?): SpeechRecognizer
 *     .start({ lang?, continuous?, interimResults? }): Promise<void>
 *     .stop(): Promise<void>     end the session, keep what was heard (a final result is delivered)
 *     .abort(): Promise<void>    end the session, drop any pending partial
 *     .onStart?()                listening has begun
 *     .onResult?(transcript, isFinal)
 *     .onError?(message, code)
 *     .onEnd?()                  the session is over (always fires once per session)
 *   The callbacks are plain mutable properties, like the browser API, so they
 *   can be passed to the factory or assigned later.
 *
 * MAPPING FROM THE CURRENT PDG CODE (drop-in notes for the wiring agent):
 *   new SpeechRecognition()          -> createSpeechRecognizer()   (create once, reuse; start() may be called again after onEnd)
 *   recognition.continuous = true    -> start({ continuous: true })
 *   recognition.interimResults=true  -> start({ interimResults: true })
 *   recognition.lang = 'en-US'       -> start({ lang: 'en-US' })   (the default)
 *   recognition.maxAlternatives = 1  -> always 1 here
 *   recognition.onstart              -> onStart
 *   recognition.onresult(event)      -> onResult(transcript, isFinal), called ONCE PER RESULT from
 *                                       event.resultIndex onwards, in order. PDG's loop that pushes
 *                                       finals and concatenates interims maps one to one: collect the
 *                                       isFinal calls as utterances, treat the others as interim text.
 *                                       The raw transcript is passed; PDG keeps applying fixTranscript.
 *   recognition.onerror(event)       -> onError(message, code). `code` is the browser's event.error
 *                                       ('aborted', 'no-speech', 'not-allowed', 'audio-capture',
 *                                       'network', ...). PDG's ignore list ('aborted', 'no-speech')
 *                                       keeps working on `code`. `message` is a readable sentence.
 *   recognition.onend                -> onEnd. PDG's restart-on-end loop keeps working: call start()
 *                                       again from onEnd.
 *   recognition.start() (sync throw) -> await start() rejects (an Error whose `code` is set, see
 *                                       SpeechStartError). Wrap it in try/catch as today.
 *   recognition.stop()/abort()       -> stop() / abort()
 *
 * NATIVE DIFFERENCES (honest limits):
 *   - The native recognizers are not continuous. Android ends the session after
 *     a pause in speech; iOS keeps listening until stop(). Either way onEnd
 *     fires, so the caller's restart-on-end loop is what makes it continuous,
 *     exactly as it is for the browser's own silence timeout today.
 *     `continuous` is accepted and has no native effect.
 *   - The plugin only reports partial hypotheses. Each partial is the whole
 *     utterance so far, so it is delivered as onResult(text, false), and the
 *     last one is delivered as onResult(text, true) when the session ends via
 *     stop() or the recognizer stopping on its own. abort() drops it.
 *   - With interimResults false, partials are not delivered; only the final is.
 *   - Permission (microphone, plus speech recognition on iOS) is requested on
 *     the first start(). A refusal rejects start() with code 'not-allowed'.
 *   - If the plugin's own start() rejects (permission revoked, recognizer not
 *     available, already listening, microphone busy), start() still resolves
 *     and the session reports onError(message, code) and then onEnd, as a
 *     browser session that fails to open does.
 *
 * ANDROID PLUGIN FACTS THIS IS BUILT AROUND (SpeechRecognition.java):
 *   - stop() never resolves its call, so it is never awaited here.
 *   - 'started' comes from onBeginningOfSpeech (the user starts talking), not
 *     when the microphone opens. Callers must not wait for onStart to treat
 *     the session as live.
 *   - 'stopped' comes from onEndOfSpeech, BEFORE the final onResults, so the
 *     session ends NATIVE_SETTLE_MS after 'stopped' to catch that result.
 *   - onError (no speech, no match, network, ...) emits nothing at all, so an
 *     idle watchdog (NATIVE_IDLE_TIMEOUT_MS) ends a session that has gone
 *     quiet: onError 'no-speech' if nothing was heard, then onEnd.
 *   - stop() and abort() always end the session (onEnd fires) without waiting
 *     on the bridge. abort() ends it synchronously.
 */
import type { PluginListenerHandle } from '@capacitor/core';
import type { SpeechRecognitionPlugin } from '@capacitor-community/speech-recognition';
import { hasNativePlugin } from './nativePlugin';

export interface SpeechStartOptions {
  /** BCP 47 language tag. Default 'en-US', which is what PDG uses. */
  lang?: string;
  /** Web only; see the header. Default true. */
  continuous?: boolean;
  /** Deliver non-final results. Default true. */
  interimResults?: boolean;
}

export interface SpeechCallbacks {
  onStart?: () => void;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (message: string, code: string) => void;
  onEnd?: () => void;
}

export interface SpeechRecognizer extends SpeechCallbacks {
  start(options?: SpeechStartOptions): Promise<void>;
  stop(): Promise<void>;
  abort(): Promise<void>;
  /** Which implementation this recognizer drives. */
  readonly kind: 'web' | 'native';
}

/** start() rejects with this. `code` uses the browser's error vocabulary. */
export class SpeechStartError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SpeechStartError';
    this.code = code;
  }
}

const PLUGIN_NAME = 'SpeechRecognition';
const DEFAULT_LANG = 'en-US';

/** Readable text for a browser SpeechRecognition error code (same wording PDG uses). */
export function speechErrorMessage(code: string): string {
  switch (code) {
    case 'audio-capture': return 'No microphone found or access denied.';
    case 'not-allowed':
    case 'service-not-allowed': return 'Microphone access denied. Please allow microphone access.';
    case 'network': return 'Network error. Please check your connection.';
    case 'no-speech': return 'No speech was detected.';
    case 'aborted': return 'Speech recognition was stopped.';
    case 'unavailable': return 'Speech recognition is not available on this device.';
    default: return code;
  }
}

// ── Web path ────────────────────────────────────────────────────────────────

/** The subset of the browser SpeechRecognition API used here. */
interface WebRecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface WebRecognitionEvent { resultIndex: number; results: ArrayLike<WebRecognitionResult> }
interface WebRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((e: WebRecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type WebRecognitionCtor = new () => WebRecognition;

export function getWebSpeechCtor(): WebRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: WebRecognitionCtor; webkitSpeechRecognition?: WebRecognitionCtor };
  const ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  return typeof ctor === 'function' ? ctor : null;
}

function createWebRecognizer(callbacks: SpeechCallbacks): SpeechRecognizer {
  let rec: WebRecognition | null = null;

  const self: SpeechRecognizer = {
    kind: 'web',
    ...callbacks,
    async start(options: SpeechStartOptions = {}) {
      const Ctor = getWebSpeechCtor();
      if (!Ctor) throw new SpeechStartError('unavailable', speechErrorMessage('unavailable'));
      // One instance, reused across sessions, as PDG does today.
      if (!rec) {
        rec = new Ctor();
        rec.onstart = () => self.onStart?.();
        rec.onresult = (event) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const r = event.results[i];
            self.onResult?.(r[0].transcript, r.isFinal);
          }
        };
        rec.onerror = (event) => self.onError?.(speechErrorMessage(event.error), event.error);
        rec.onend = () => self.onEnd?.();
      }
      rec.continuous = options.continuous ?? true;
      rec.interimResults = options.interimResults ?? true;
      rec.lang = options.lang ?? DEFAULT_LANG;
      rec.maxAlternatives = 1;
      try {
        rec.start();
      } catch (err) {
        // The browser throws InvalidStateError when a session is already running.
        const name = (err as { name?: string })?.name ?? 'start-failed';
        throw new SpeechStartError(name, (err as Error)?.message || 'Could not start speech recognition.');
      }
    },
    async stop() { rec?.stop(); },
    async abort() { rec?.abort(); },
  };
  return self;
}

// ── Native path ─────────────────────────────────────────────────────────────

let pluginPromise: Promise<SpeechRecognitionPlugin> | null = null;
function loadPlugin(): Promise<SpeechRecognitionPlugin> {
  return (pluginPromise ??= import('@capacitor-community/speech-recognition').then(m => m.SpeechRecognition));
}

/** A plugin call or listener removal that has not settled by now is abandoned.
 *  Android's stop() never resolves its call at all. */
export const NATIVE_PLUGIN_CALL_TIMEOUT_MS = 1000;
/** After the recognizer reports 'stopped', wait this long for a trailing result
 *  before ending the session. Android emits 'stopped' (onEndOfSpeech) BEFORE
 *  the final onResults, and iOS sends its final hypothesis after stop(). */
export const NATIVE_SETTLE_MS = 300;
/** A session with no partial result and no state event for this long is over.
 *  Android's no-speech and error paths (SPEECH_TIMEOUT, NO_MATCH, NETWORK, ...)
 *  reject an already resolved call and emit nothing, so without this the
 *  adapter would wait forever. Android's own silence timeout plus a margin. */
export const NATIVE_IDLE_TIMEOUT_MS = 12000;

/** Resolves when `p` settles or after `ms`, whichever is first. Never rejects. */
function settleWithin(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    const t = setTimeout(resolve, ms);
    p.then(
      () => { clearTimeout(t); resolve(); },
      () => { clearTimeout(t); resolve(); },
    );
  });
}

/** Maps a plugin start() rejection message to the browser's error vocabulary. */
export function nativeStartErrorCode(message: string): string {
  if (/permission|denied|not allowed/i.test(message)) return 'not-allowed';
  // "Microphone is already in use by another application." is a capture problem.
  if (/not available|unavailable|microphone|audio/i.test(message)) return 'audio-capture';
  if (/ongoing|already|busy/i.test(message)) return 'aborted';
  if (/network/i.test(message)) return 'network';
  if (/no match|no speech/i.test(message)) return 'no-speech';
  return 'start-failed';
}

function createNativeRecognizer(callbacks: SpeechCallbacks): SpeechRecognizer {
  let handles: PluginListenerHandle[] = [];
  let lastPartial = '';
  let active = false;
  let deliverInterim = true;
  /** Bumped per session so a late event or timer from an old one is ignored. */
  let session = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveEnded: (() => void) | null = null;
  let ended: Promise<void> = Promise.resolve();

  const clearTimers = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (settleTimer) clearTimeout(settleTimer);
    idleTimer = null;
    settleTimer = null;
  };

  /** Detaches the listeners at once; waits at most the call timeout for the bridge. */
  const removeListeners = (): Promise<void> => {
    const hs = handles;
    handles = [];
    if (hs.length === 0) return Promise.resolve();
    return settleWithin(Promise.all(hs.map(h => h.remove())), NATIVE_PLUGIN_CALL_TIMEOUT_MS);
  };

  /** Fire and forget: never awaited, so a call that never settles cannot hang us. */
  const stopPlugin = () => {
    void loadPlugin().then(p => p.stop()).catch(() => undefined);
  };

  /** Ends the session exactly once: final result (unless dropped), then onEnd.
   *  Synchronous so abort() and unmount complete promptly. */
  const finish = (keepFinal: boolean) => {
    if (!active) return;
    active = false;
    session++;
    clearTimers();
    const text = keepFinal ? lastPartial.trim() : '';
    lastPartial = '';
    void removeListeners();
    const done = resolveEnded;
    resolveEnded = null;
    try {
      if (text) self.onResult?.(text, true);
      self.onEnd?.();
    } finally {
      done?.();
    }
  };

  /** End after a short grace period so a trailing result can still land. A
   *  second request while one is pending is ignored; finish() clears it. */
  const settle = () => {
    if (!active || settleTimer) return;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    const sid = session;
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (sid === session) finish(true);
    }, NATIVE_SETTLE_MS);
  };

  /** (Re)arms the idle watchdog; see NATIVE_IDLE_TIMEOUT_MS. */
  const armIdle = () => {
    if (!active || settleTimer) return;
    if (idleTimer) clearTimeout(idleTimer);
    const sid = session;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (sid !== session || !active) return;
      stopPlugin();
      // Heard something and then nothing more: end normally with what was heard.
      if (!lastPartial.trim()) self.onError?.(speechErrorMessage('no-speech'), 'no-speech');
      finish(true);
    }, NATIVE_IDLE_TIMEOUT_MS);
  };

  const self: SpeechRecognizer = {
    kind: 'native',
    ...callbacks,
    async start(options: SpeechStartOptions = {}) {
      if (active) throw new SpeechStartError('InvalidStateError', 'Speech recognition is already running.');
      const plugin = await loadPlugin();
      const { available } = await plugin.available().catch(() => ({ available: false }));
      if (!available) throw new SpeechStartError('unavailable', speechErrorMessage('unavailable'));

      let perm = await plugin.checkPermissions().catch(() => ({ speechRecognition: 'denied' as const }));
      if (perm.speechRecognition !== 'granted') {
        perm = await plugin.requestPermissions().catch(() => ({ speechRecognition: 'denied' as const }));
      }
      if (perm.speechRecognition !== 'granted') {
        throw new SpeechStartError('not-allowed', speechErrorMessage('not-allowed'));
      }

      deliverInterim = options.interimResults ?? true;
      lastPartial = '';
      await removeListeners();
      if (active) throw new SpeechStartError('InvalidStateError', 'Speech recognition is already running.');
      active = true;
      const sid = session;
      ended = new Promise<void>(resolve => { resolveEnded = resolve; });
      const live = () => sid === session && active;

      // A handle that arrives after the session already ended (abort() while
      // addListener was in flight) is removed at once instead of leaking.
      const keep = (h: PluginListenerHandle) => {
        if (live()) handles.push(h);
        else void settleWithin(h.remove(), NATIVE_PLUGIN_CALL_TIMEOUT_MS);
      };
      keep(await plugin.addListener('partialResults', (data) => {
        if (!live()) return;
        const text = data.matches?.[0] ?? '';
        if (!text) return;
        lastPartial = text;
        // In the settle window this is the trailing (final) result: no interim.
        if (settleTimer) return;
        armIdle();
        if (deliverInterim) self.onResult?.(text, false);
      }));
      keep(await plugin.addListener('listeningState', (data) => {
        if (!live()) return;
        // Android sends 'started' when the user begins speaking, not when the
        // microphone opens; iOS sends it when the audio engine starts.
        if (data.status === 'started') { armIdle(); self.onStart?.(); }
        else settle();
      }));
      if (!live()) return; // aborted while the listeners were being attached

      try {
        // partialResults: true makes start() resolve immediately and stream
        // hypotheses through the listener. popup: false keeps Android's own
        // dialog out of the way (partials do not work with it).
        await plugin.start({
          language: options.lang ?? DEFAULT_LANG,
          maxResults: 1,
          partialResults: true,
          popup: false,
        });
      } catch (err) {
        // Like the browser: a session that fails to open reports onError, then
        // onEnd. Deferred so the caller's start().then runs first, as it would
        // for a browser session that errors after start().
        const message = (err as Error)?.message || 'Could not start speech recognition.';
        const code = nativeStartErrorCode(message);
        setTimeout(() => {
          if (!live()) return;
          self.onError?.(code === 'start-failed' ? message : speechErrorMessage(code), code);
          finish(false);
        }, 0);
        return;
      }
      armIdle();
    },
    async stop() {
      if (!active) return;
      const wait = ended;
      stopPlugin();
      settle();
      await wait;
    },
    async abort() {
      if (!active) return;
      stopPlugin();
      finish(false);
    },
  };
  return self;
}

// ── Public entry points ─────────────────────────────────────────────────────

function nativePathActive(): boolean {
  return hasNativePlugin(PLUGIN_NAME);
}

/** True when dictation can work here. Never rejects. */
export async function isSpeechAvailable(): Promise<boolean> {
  if (nativePathActive()) {
    try {
      const plugin = await loadPlugin();
      const { available } = await plugin.available();
      return available;
    } catch {
      return false;
    }
  }
  return getWebSpeechCtor() !== null;
}

export function createSpeechRecognizer(callbacks: SpeechCallbacks = {}): SpeechRecognizer {
  return nativePathActive() ? createNativeRecognizer(callbacks) : createWebRecognizer(callbacks);
}

/** Test hook: forget the cached dynamic import. */
export function __resetSpeechPluginForTests(): void {
  pluginPromise = null;
}
