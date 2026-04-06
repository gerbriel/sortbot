/**
 * Centralized debug logger.
 *
 * All components and services call `dbg(category, message, ...data)`.
 * Logging is a no-op unless `window.__SORTBOT_DEBUG__ === true`.
 *
 * Enable at runtime:
 *  - Click the "Debug Logging" toggle under the Sign Out button, OR
 *  - Open DevTools and run: window.__SORTBOT_DEBUG__ = true
 *
 * The toggle also installs global DOM listeners for mouse, keyboard, drag,
 * and scroll events so every interaction is captured automatically.
 */

declare global {
  interface Window {
    __SORTBOT_DEBUG__: boolean;
  }
}

// ── Storage key ───────────────────────────────────────────────────────────────
const STORAGE_KEY = 'sortbot_debug_enabled';

// ── Bootstrap from localStorage so the setting survives page reloads ─────────
window.__SORTBOT_DEBUG__ = localStorage.getItem(STORAGE_KEY) === 'true';

// ── Category colour map for readable console groups ───────────────────────────
const COLOURS: Record<string, string> = {
  App:       '#6366f1',
  Library:   '#0ea5e9',
  Grouper:   '#f59e0b',
  Upload:    '#10b981',
  PDG:       '#ec4899',
  Sorter:    '#8b5cf6',
  Service:   '#64748b',
  DB:        '#0284c7',
  Auth:      '#7c3aed',
  DOM:       '#94a3b8',
  Error:     '#ef4444',
};

function colour(cat: string): string {
  return COLOURS[cat] ?? '#334155';
}

// ── Core log function ─────────────────────────────────────────────────────────
export function dbg(category: string, message: string, ...data: unknown[]): void {
  if (!window.__SORTBOT_DEBUG__) return;
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const badge = `%c[${category}]%c ${ts} ${message}`;
  const styles = [`color:${colour(category)};font-weight:bold`, 'color:inherit;font-weight:normal'];
  if (data.length > 0) {
    console.groupCollapsed(badge, ...styles);
    data.forEach(d => console.log(d));
    console.groupEnd();
  } else {
    console.log(badge, ...styles);
  }
}

// ── Convenience wrappers by category ─────────────────────────────────────────
export const log = {
  app:     (msg: string, ...d: unknown[]) => dbg('App',     msg, ...d),
  library: (msg: string, ...d: unknown[]) => dbg('Library', msg, ...d),
  grouper: (msg: string, ...d: unknown[]) => dbg('Grouper', msg, ...d),
  upload:  (msg: string, ...d: unknown[]) => dbg('Upload',  msg, ...d),
  pdg:     (msg: string, ...d: unknown[]) => dbg('PDG',     msg, ...d),
  sorter:  (msg: string, ...d: unknown[]) => dbg('Sorter',  msg, ...d),
  service: (msg: string, ...d: unknown[]) => dbg('Service', msg, ...d),
  db:      (msg: string, ...d: unknown[]) => dbg('DB',      msg, ...d),
  auth:    (msg: string, ...d: unknown[]) => dbg('Auth',    msg, ...d),
  dom:     (msg: string, ...d: unknown[]) => dbg('DOM',     msg, ...d),
  error:   (msg: string, ...d: unknown[]) => dbg('Error',   msg, ...d),
};

// ── Global DOM event listeners (mouse, keyboard, drag, scroll) ────────────────
// Attached once, only when debug is first enabled.  Removed when disabled.

type Listener = { type: string; fn: EventListenerOrEventListenerObject; opts?: boolean | AddEventListenerOptions };
const _domListeners: Listener[] = [];
let _domListenersAttached = false;

const DOM_THROTTLE_MS = 100; // mousemove / scroll throttle
let _lastMouseMove = 0;
let _lastScroll = 0;

function attachDomListeners() {
  if (_domListenersAttached) return;
  _domListenersAttached = true;

  const add = (type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
    document.addEventListener(type, fn, opts);
    _domListeners.push({ type, fn, opts });
  };

  // ── Mouse ──
  add('click', (e) => {
    const t = e.target as HTMLElement;
    dbg('DOM', `click → ${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''}${t.className ? '.' + String(t.className).split(' ')[0] : ''}`, { target: t, event: e });
  });

  add('dblclick', (e) => {
    const t = e.target as HTMLElement;
    dbg('DOM', `dblclick → ${t.tagName.toLowerCase()}`, { target: t });
  });

  add('contextmenu', (e) => {
    const t = e.target as HTMLElement;
    dbg('DOM', `contextmenu → ${t.tagName.toLowerCase()}`, { target: t });
  });

  add('mousedown', (e) => {
    const me = e as MouseEvent;
    const t = me.target as HTMLElement;
    dbg('DOM', `mousedown button=${me.button} → ${t.tagName.toLowerCase()}`, { x: me.clientX, y: me.clientY });
  });

  add('mouseup', (e) => {
    const me = e as MouseEvent;
    dbg('DOM', `mouseup button=${me.button}`, { x: me.clientX, y: me.clientY });
  });

  add('mousemove', (e) => {
    const now = Date.now();
    if (now - _lastMouseMove < DOM_THROTTLE_MS) return;
    _lastMouseMove = now;
    const me = e as MouseEvent;
    dbg('DOM', `mousemove`, { x: me.clientX, y: me.clientY });
  }, { passive: true });

  // ── Keyboard ──
  add('keydown', (e) => {
    const ke = e as KeyboardEvent;
    dbg('DOM', `keydown key="${ke.key}" code="${ke.code}" shift=${ke.shiftKey} ctrl=${ke.ctrlKey} meta=${ke.metaKey}`);
  });

  add('keyup', (e) => {
    const ke = e as KeyboardEvent;
    dbg('DOM', `keyup key="${ke.key}"`);
  });

  // ── Drag & Drop ──
  add('dragstart', (e) => {
    const de = e as DragEvent;
    const t = de.target as HTMLElement;
    dbg('DOM', `dragstart → ${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''}`, { dataTransfer: de.dataTransfer?.types });
  });

  add('dragover', (e) => {
    const de = e as DragEvent;
    const t = de.target as HTMLElement;
    dbg('DOM', `dragover → ${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''}`);
  });

  add('dragenter', (e) => {
    const de = e as DragEvent;
    const t = de.target as HTMLElement;
    dbg('DOM', `dragenter → ${t.tagName.toLowerCase()}`);
  });

  add('dragleave', (e) => {
    const de = e as DragEvent;
    const t = de.target as HTMLElement;
    dbg('DOM', `dragleave ← ${t.tagName.toLowerCase()}`);
  });

  add('drop', (e) => {
    const de = e as DragEvent;
    const t = de.target as HTMLElement;
    dbg('DOM', `drop → ${t.tagName.toLowerCase()}`, { dataTransfer: de.dataTransfer?.types });
  });

  add('dragend', () => {
    dbg('DOM', `dragend`);
  });

  // ── Scroll ──
  add('scroll', () => {
    const now = Date.now();
    if (now - _lastScroll < DOM_THROTTLE_MS) return;
    _lastScroll = now;
    dbg('DOM', `scroll`, { x: window.scrollX, y: window.scrollY });
  }, { passive: true, capture: true });

  // ── Selection ──
  add('selectionchange', () => {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) {
      dbg('DOM', `selectionchange`, { text: sel.toString().slice(0, 80) });
    }
  });

  // ── Focus ──
  add('focusin', (e) => {
    const t = e.target as HTMLElement;
    dbg('DOM', `focusin → ${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''}`);
  });

  add('focusout', (e) => {
    const t = e.target as HTMLElement;
    dbg('DOM', `focusout ← ${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''}`);
  });

  // ── Input / Change ──
  add('input', (e) => {
    const t = e.target as HTMLInputElement;
    dbg('DOM', `input → ${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''} name="${t.name}"`, { value: t.value?.slice(0, 60) });
  });

  add('change', (e) => {
    const t = e.target as HTMLInputElement;
    dbg('DOM', `change → ${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''} name="${t.name}"`, { value: t.value?.slice(0, 60) });
  });
}

function detachDomListeners() {
  _domListeners.forEach(({ type, fn, opts }) => {
    document.removeEventListener(type, fn, opts);
  });
  _domListeners.length = 0;
  _domListenersAttached = false;
}

// ── Toggle function (called by the UI button) ─────────────────────────────────
export function setDebugEnabled(enabled: boolean): void {
  window.__SORTBOT_DEBUG__ = enabled;
  if (enabled) {
    localStorage.setItem(STORAGE_KEY, 'true');
    attachDomListeners();
    dbg('App', `🐛 Debug logging ENABLED — all DOM events, actions, and data flows will be logged`);
  } else {
    dbg('App', `🐛 Debug logging DISABLED`);
    localStorage.removeItem(STORAGE_KEY);
    detachDomListeners();
  }
}

export function isDebugEnabled(): boolean {
  return window.__SORTBOT_DEBUG__ === true;
}

// Auto-attach listeners if debug was already on from a previous session
if (window.__SORTBOT_DEBUG__) {
  attachDomListeners();
}
