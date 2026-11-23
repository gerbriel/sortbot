import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const listeners: Record<string, (data?: unknown) => void> = {};
  const removes: Array<ReturnType<typeof vi.fn>> = [];
  const plugin = {
    setAccessoryBarVisible: vi.fn(async (opts: { isVisible: boolean }) => { void opts; }),
    addListener: vi.fn(async (name: string, fn: (data?: unknown) => void) => {
      listeners[name] = fn;
      const remove = vi.fn(async () => { delete listeners[name]; });
      removes.push(remove);
      return { remove };
    }),
  };
  return { listeners, removes, plugin, native: { value: false }, platform: { value: 'web' } };
});

vi.mock('./nativePlugin', () => ({ hasNativePlugin: () => h.native.value }));
vi.mock('../platform', () => ({ platform: () => h.platform.value }));
vi.mock('@capacitor/keyboard', () => ({ Keyboard: h.plugin }));

import { subscribeKeyboard, keyboardResizesWebview, initKeyboard, __resetKeyboardPluginForTests } from './keyboard';

async function flush() {
  // The dynamic import resolves on a later task, not a microtask.
  for (let i = 0; i < 3; i++) await new Promise(r => setTimeout(r, 0));
}

/** A stand-in visualViewport: an EventTarget with a settable box. */
class FakeVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  set(height: number, offsetTop = 0, type: 'resize' | 'scroll' = 'resize') {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event(type));
  }
}

describe('subscribeKeyboard, native path', () => {
  beforeEach(() => {
    h.native.value = true;
    h.removes.length = 0;
    for (const k of Object.keys(h.listeners)) delete h.listeners[k];
    __resetKeyboardPluginForTests();
  });
  afterEach(() => { h.native.value = false; vi.clearAllMocks(); });

  it('reports that the webview resizes itself', () => {
    expect(keyboardResizesWebview()).toBe(true);
  });

  it('relays keyboardWillShow with its height and keyboardWillHide as closed', async () => {
    const cb = vi.fn();
    const off = subscribeKeyboard(cb);
    await flush();
    h.listeners.keyboardWillShow({ keyboardHeight: 336.4 });
    expect(cb).toHaveBeenLastCalledWith({ open: true, height: 336 });
    h.listeners.keyboardWillHide();
    expect(cb).toHaveBeenLastCalledWith({ open: false, height: 0 });
    off();
    expect(h.removes).toHaveLength(2);
    h.removes.forEach(r => expect(r).toHaveBeenCalled());
  });

  it('an unsubscribe before the listeners attach still removes them', async () => {
    const off = subscribeKeyboard(vi.fn());
    off();
    await flush();
    expect(h.removes).toHaveLength(2);
    h.removes.forEach(r => expect(r).toHaveBeenCalled());
  });
});

describe('subscribeKeyboard, web path', () => {
  let vv: FakeVisualViewport;
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');

  beforeEach(() => {
    h.native.value = false;
    vv = new FakeVisualViewport();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 });
  });
  afterEach(() => {
    if (original) Object.defineProperty(window, 'visualViewport', original);
    else delete (window as { visualViewport?: unknown }).visualViewport;
    delete (document.documentElement as { clientHeight?: unknown }).clientHeight;
    vi.clearAllMocks();
  });

  it('never touches the plugin', () => {
    expect(keyboardResizesWebview()).toBe(false);
    const off = subscribeKeyboard(vi.fn());
    off();
    expect(h.plugin.addListener).not.toHaveBeenCalled();
  });

  it('reports the current state at subscribe time, then each visual viewport change', () => {
    const cb = vi.fn();
    const off = subscribeKeyboard(cb);
    expect(cb).toHaveBeenLastCalledWith({ open: false, height: 0 });
    vv.set(460);
    expect(cb).toHaveBeenLastCalledWith({ open: true, height: 340 });
    vv.set(460, 100, 'scroll');
    expect(cb).toHaveBeenLastCalledWith({ open: true, height: 240 });
    vv.set(800);
    expect(cb).toHaveBeenLastCalledWith({ open: false, height: 0 });
    off();
  });

  it('a browser chrome change is not a keyboard, and duplicates are not re-sent', () => {
    const cb = vi.fn();
    const off = subscribeKeyboard(cb);
    vv.set(744);
    vv.set(744);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith({ open: false, height: 0 });
    off();
  });

  it('stops listening on unsubscribe', () => {
    const cb = vi.fn();
    const off = subscribeKeyboard(cb);
    off();
    vv.set(460);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('without visualViewport it reports closed once', () => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
    const cb = vi.fn();
    subscribeKeyboard(cb)();
    expect(cb).toHaveBeenCalledWith({ open: false, height: 0 });
  });
});

describe('initKeyboard', () => {
  afterEach(() => { h.native.value = false; h.platform.value = 'web'; vi.clearAllMocks(); __resetKeyboardPluginForTests(); });

  it('turns the iOS form accessory bar back on', async () => {
    h.native.value = true;
    h.platform.value = 'ios';
    await initKeyboard();
    expect(h.plugin.setAccessoryBarVisible).toHaveBeenCalledWith({ isVisible: true });
  });

  it('does nothing on Android or the web', async () => {
    h.native.value = true;
    h.platform.value = 'android';
    await initKeyboard();
    h.native.value = false;
    h.platform.value = 'web';
    await initKeyboard();
    expect(h.plugin.setAccessoryBarVisible).not.toHaveBeenCalled();
  });

  it('never throws when the plugin call fails', async () => {
    h.native.value = true;
    h.platform.value = 'ios';
    h.plugin.setAccessoryBarVisible.mockRejectedValueOnce(new Error('not implemented'));
    await expect(initKeyboard()).resolves.toBeUndefined();
  });
});
