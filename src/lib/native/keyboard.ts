/**
 * keyboard.ts: "is the on-screen keyboard open, and how tall is it?"
 *
 * One subscription for the browser and the native app. Step 2's category dock
 * (CategoryZones) uses it to sit directly above the keyboard while its search is
 * focused (AGENTS.md §10 Step 2, "The dock and the keyboard").
 *
 * WHICH PATH RUNS:
 *   native  when hasNativePlugin('Keyboard'). @capacitor/keyboard is imported
 *           dynamically and its keyboardWillShow / keyboardWillHide events are
 *           relayed, height from the event. The plugin is configured with
 *           `resize: 'native'` (capacitor.config.ts), which shrinks the WEBVIEW
 *           FRAME itself, so the layout viewport ends at the top of the keyboard
 *           and sticky-bottom surfaces rise on their own. That is why
 *           keyboardResizesWebview() is true there and the dock's `--kb` stays 0:
 *           adding the height again would lift the dock twice.
 *           (The plugin also removes WKWebView's own keyboard handling, so on
 *           iOS the visualViewport path below would read nothing in the app.)
 *   web     everywhere else. visualViewport `resize` and `scroll` are relayed
 *           through keyboardInsetFrom (src/lib/keyboardInset.ts), because the
 *           browser shrinks the visual viewport only and a bottom-stuck surface
 *           has to be lifted by the inset by hand. No visualViewport (old
 *           engines, happy-dom) means the callback reports closed once and the
 *           dock behaves as it did before.
 *
 * API:
 *   subscribeKeyboard(cb) -> unsubscribe
 *     cb({ open, height }) fires on every change; on the web also once at subscribe
 *     time with the current state. `height` is in CSS pixels: the keyboard's height
 *     on native, the covered part of the layout viewport on the web (0 when closed).
 *   keyboardResizesWebview(): boolean   true when the native plugin resizes the webview.
 *   initKeyboard(): Promise<void>       one-time iOS setup (main.tsx), see below.
 */
import type { KeyboardPlugin } from '@capacitor/keyboard';
import { hasNativePlugin } from './nativePlugin';
import { platform } from '../platform';
import { isKeyboardOpen, keyboardInsetFrom } from '../keyboardInset';

export interface KeyboardState {
  open: boolean;
  height: number;
}

const PLUGIN_NAME = 'Keyboard';

let pluginPromise: Promise<KeyboardPlugin> | null = null;
function loadPlugin(): Promise<KeyboardPlugin> {
  return (pluginPromise ??= import('@capacitor/keyboard').then(m => m.Keyboard));
}

/**
 * One-time native setup, called from main.tsx. On iOS the plugin hides the
 * keyboard's form accessory bar (Done / previous / next) for EVERY input as soon
 * as it loads, with no config switch; without Done there is no obvious way to
 * dismiss the keyboard from Step 3's textareas. This turns it back on. Does
 * nothing on the web or Android, and never throws.
 */
export async function initKeyboard(): Promise<void> {
  if (!keyboardResizesWebview() || platform() !== 'ios') return;
  try {
    const kb = await loadPlugin();
    await kb.setAccessoryBarVisible({ isVisible: true });
  } catch {
    // Not fatal: the keyboard still works, only without its accessory bar.
  }
}

/** True inside the native app with the Keyboard plugin linked (sync). */
export function keyboardResizesWebview(): boolean {
  return hasNativePlugin(PLUGIN_NAME);
}

export function subscribeKeyboard(cb: (state: KeyboardState) => void): () => void {
  return keyboardResizesWebview() ? subscribeNative(cb) : subscribeWeb(cb);
}

function subscribeNative(cb: (state: KeyboardState) => void): () => void {
  let cancelled = false;
  const handles: Array<{ remove: () => Promise<void> }> = [];
  void (async () => {
    try {
      const kb = await loadPlugin();
      const show = await kb.addListener('keyboardWillShow', info => {
        cb({ open: true, height: Math.max(0, Math.round(info?.keyboardHeight ?? 0)) });
      });
      const hide = await kb.addListener('keyboardWillHide', () => cb({ open: false, height: 0 }));
      handles.push(show, hide);
      if (cancelled) handles.forEach(h => void h.remove());
    } catch {
      // A plugin that fails to load leaves the dock in its pre-keyboard behaviour.
    }
  })();
  return () => {
    cancelled = true;
    handles.forEach(h => void h.remove());
    handles.length = 0;
  };
}

function subscribeWeb(cb: (state: KeyboardState) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const vv = window.visualViewport;
  if (!vv) {
    cb({ open: false, height: 0 });
    return () => {};
  }
  let last: KeyboardState | null = null;
  const emit = () => {
    const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
    const inset = keyboardInsetFrom({ height: vv.height, offsetTop: vv.offsetTop }, layoutHeight);
    const open = isKeyboardOpen(inset);
    const next: KeyboardState = { open, height: open ? inset : 0 };
    if (last && last.open === next.open && last.height === next.height) return;
    last = next;
    cb(next);
  };
  vv.addEventListener('resize', emit);
  vv.addEventListener('scroll', emit);
  emit();
  return () => {
    vv.removeEventListener('resize', emit);
    vv.removeEventListener('scroll', emit);
  };
}

/** Test hook: forget the cached plugin import. */
export function __resetKeyboardPluginForTests(): void {
  pluginPromise = null;
}
