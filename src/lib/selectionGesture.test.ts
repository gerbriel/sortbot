import { describe, it, expect } from 'vitest';
import {
  TOGGLE_REPEAT_MS,
  isRepeatToggle,
  isSelectionModeActive,
  shouldOpenLightbox,
  type GestureModes,
} from './selectionGesture';

/**
 * Founder report 30 — "when multi-selecting, don't allow double-click to zoom in
 * on the photo. Keep it in selection mode until they are either deselected or
 * something."
 *
 * These lock the arbitration `ImageGrouper`'s three click surfaces (singles
 * cards, group photos, the group select bar) now share. The component itself has
 * no harness, so the rules live in a pure module and the handlers are three
 * lines each on top of these.
 */

const modes = (over: Partial<GestureModes> = {}): GestureModes => ({
  selectedAtGestureStart: 0,
  pickMode: false,
  photoSelectMode: false,
  ...over,
});

describe('isRepeatToggle — one gesture, one toggle', () => {
  it('a first click on a target is never a repeat', () => {
    expect(isRepeatToggle(undefined, 1_000)).toBe(false);
  });

  it("a double-click's second mousedown (~15 ms later) IS a repeat", () => {
    expect(isRepeatToggle(1_000, 1_015)).toBe(true);
  });

  it('a deliberate second click after the window is NOT a repeat', () => {
    expect(isRepeatToggle(1_000, 1_000 + TOGGLE_REPEAT_MS)).toBe(false);
    expect(isRepeatToggle(1_000, 1_000 + TOGGLE_REPEAT_MS + 1)).toBe(false);
  });

  it('the window is 200 ms — a hardware double-click is ~10–15 ms', () => {
    expect(TOGGLE_REPEAT_MS).toBe(200);
  });
});

describe('isSelectionModeActive / shouldOpenLightbox', () => {
  it('nothing selected and both pick modes off → the double-click zooms', () => {
    expect(isSelectionModeActive(modes())).toBe(false);
    expect(shouldOpenLightbox(modes())).toBe(true);
  });

  it('REPORT 30: anything already selected → no zoom, it stays a selection gesture', () => {
    expect(shouldOpenLightbox(modes({ selectedAtGestureStart: 1 }))).toBe(false);
    expect(shouldOpenLightbox(modes({ selectedAtGestureStart: 42 }))).toBe(false);
  });

  it('REPORT 30: pick mode on → no zoom, even with an empty selection', () => {
    // Pick mode owns the selection lifecycle and auto-advances after each group
    // action, so it is "selecting" even in the instant its selection is empty.
    expect(shouldOpenLightbox(modes({ pickMode: true }))).toBe(false);
  });

  it('REPORT 30: photo-select mode on → no zoom (this is the group-card case)', () => {
    expect(shouldOpenLightbox(modes({ photoSelectMode: true }))).toBe(false);
  });

  it('the gate reads the gesture START, not the live selection', () => {
    // The first mousedown of a double-click has already selected the item by the
    // time `dblclick` fires. Judged live, EVERY double-click would look like
    // "the user is selecting" and the lightbox would be unreachable — which is
    // why the caller snapshots the selection before the first toggle.
    const liveAfterFirstMousedown = modes({ selectedAtGestureStart: 0 });
    expect(shouldOpenLightbox(liveAfterFirstMousedown)).toBe(true);
  });
});

describe('the whole gesture, replayed', () => {
  /** Minimal replay of the handler wiring in ImageGrouper. */
  const grid = (initial: string[] = [], opts: { pickMode?: boolean; photoSelectMode?: boolean } = {}) => {
    let selection = new Set(initial);
    let gestureStart = new Set<string>();
    const lastAt = new Map<string, number>();
    let lightboxOpenedFor: string | null = null;
    let now = 10_000;

    const mousedown = (id: string) => {
      if (!isRepeatToggle(lastAt.get(id), now)) gestureStart = new Set(selection);
      if (isRepeatToggle(lastAt.get(id), now)) return;      // toggle debounce
      lastAt.set(id, now);
      if (selection.has(id)) selection.delete(id); else selection.add(id);
    };
    const dblclick = (id: string) => {
      const m = {
        selectedAtGestureStart: gestureStart.size,
        pickMode: !!opts.pickMode,
        photoSelectMode: !!opts.photoSelectMode,
      };
      if (!shouldOpenLightbox(m)) return;
      selection = new Set(gestureStart);   // a zoom is not a selection
      lightboxOpenedFor = id;
    };
    /** A real double-click: two mousedowns 15 ms apart, then dblclick. */
    const doubleClick = (id: string) => {
      mousedown(id); now += 15; mousedown(id); dblclick(id);
      now += 1_000;                        // next gesture is well clear of the window
    };
    return {
      doubleClick,
      singleClick: (id: string) => { mousedown(id); now += 1_000; },
      get selection() { return [...selection].sort(); },
      get lightbox() { return lightboxOpenedFor; },
    };
  };

  it('nothing selected: double-click zooms and leaves the selection empty', () => {
    const g = grid();
    g.doubleClick('a');
    expect(g.lightbox).toBe('a');
    expect(g.selection).toEqual([]);   // not left half-selected by the gesture
  });

  it('REPORT 30: with a selection, double-click selects once and never zooms', () => {
    const g = grid(['a']);
    g.doubleClick('b');
    expect(g.lightbox).toBeNull();
    expect(g.selection).toEqual(['a', 'b']);   // exactly one toggle
  });

  it('REPORT 30: double-clicking a SELECTED item deselects it exactly once', () => {
    const g = grid(['a', 'b']);
    g.doubleClick('b');
    expect(g.lightbox).toBeNull();
    expect(g.selection).toEqual(['a']);        // never bounces back — no half-toggle
  });

  it('REPORT 30: in photo-select mode a double-click toggles once, no zoom', () => {
    const g = grid([], { photoSelectMode: true });
    g.doubleClick('p1');
    expect(g.lightbox).toBeNull();
    expect(g.selection).toEqual(['p1']);
  });

  it('zoom comes back once the selection is cleared', () => {
    const g = grid(['a']);
    g.doubleClick('b');
    expect(g.lightbox).toBeNull();
    g.singleClick('a'); g.singleClick('b');    // deselect both
    expect(g.selection).toEqual([]);
    g.doubleClick('c');
    expect(g.lightbox).toBe('c');
  });

  it('two separate single clicks still toggle twice — the guard is per gesture', () => {
    const g = grid();
    g.singleClick('a');
    g.singleClick('a');
    expect(g.selection).toEqual([]);
  });
});
