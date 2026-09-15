import { describe, it, expect } from 'vitest';
import {
  SHORTCUTS,
  SHORTCUT_SCOPES,
  SHORTCUT_SCOPE_LABEL,
  shortcutsFor,
  groupedShortcuts,
  platformKeys,
  splitKeys,
  detectIsMac,
} from './keyboardShortcuts';

/**
 * The shortcut list is the ONLY place users can discover a key binding, so
 * these tests guard two things: the pure render helpers the ShortcutsPanel
 * leans on, and the list's own integrity (no scope without a label, no
 * duplicate row, no Windows user shown a ⌘).
 */

describe('platformKeys', () => {
  it('leaves Apple keys alone', () => {
    expect(platformKeys('⌘ Shift A', true)).toBe('⌘ Shift A');
  });

  it('substitutes Ctrl everywhere else', () => {
    expect(platformKeys('⌘ Shift A', false)).toBe('Ctrl Shift A');
  });

  it('substitutes every occurrence, not just the first', () => {
    expect(platformKeys('⌘ A ⌘ B', false)).toBe('Ctrl A Ctrl B');
  });

  it('is a no-op for rows with no platform modifier', () => {
    expect(platformKeys('Esc', false)).toBe('Esc');
    expect(platformKeys('← →', false)).toBe('← →');
  });

  it('never leaves a ⌘ on a non-Apple platform for any real row', () => {
    for (const s of SHORTCUTS) {
      expect(platformKeys(s.keys, false)).not.toContain('⌘');
    }
  });
});

describe('splitKeys', () => {
  it('splits a combo into one token per key', () => {
    expect(splitKeys('⌘ Shift Z')).toEqual(['⌘', 'Shift', 'Z']);
  });

  it('keeps a single key as one token', () => {
    expect(splitKeys('Esc')).toEqual(['Esc']);
  });

  it('drops empty tokens rather than rendering a blank kbd', () => {
    expect(splitKeys('⌘  A ')).toEqual(['⌘', 'A']);
  });
});

describe('detectIsMac', () => {
  it.each(['MacIntel', 'iPhone', 'iPad', 'Macintosh; Intel Mac OS X 10_15_7'])(
    'treats %s as Apple',
    (platform) => expect(detectIsMac(platform)).toBe(true),
  );

  it.each(['Win32', 'Linux x86_64', 'Android', ''])(
    'treats %s as non-Apple',
    (platform) => expect(detectIsMac(platform)).toBe(false),
  );
});

describe('shortcutsFor', () => {
  it('returns only that scope, in declaration order', () => {
    const step3 = shortcutsFor('step3');
    expect(step3.length).toBeGreaterThan(0);
    expect(step3.every((s) => s.scope === 'step3')).toBe(true);
    expect(step3.map((s) => s.keys)).toEqual(
      SHORTCUTS.filter((s) => s.scope === 'step3').map((s) => s.keys),
    );
  });
});

describe('groupedShortcuts', () => {
  it('groups in SHORTCUT_SCOPES order with a label per group', () => {
    const groups = groupedShortcuts();
    expect(groups.map((g) => g.scope)).toEqual(SHORTCUT_SCOPES);
    for (const g of groups) expect(g.label).toBe(SHORTCUT_SCOPE_LABEL[g.scope]);
  });

  it('accounts for every shortcut exactly once', () => {
    const total = groupedShortcuts().reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(SHORTCUTS.length);
  });

  it('omits scopes that have no rows', () => {
    expect(groupedShortcuts().every((g) => g.items.length > 0)).toBe(true);
  });
});

describe('the SHORTCUTS list itself', () => {
  it('has a label for every scope it uses', () => {
    for (const s of SHORTCUTS) expect(SHORTCUT_SCOPE_LABEL[s.scope]).toBeTruthy();
  });

  it('has no duplicate key/scope pair', () => {
    const seen = SHORTCUTS.map((s) => `${s.scope}:${s.keys}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('gives every row a non-empty key and action', () => {
    for (const s of SHORTCUTS) {
      expect(s.keys.trim()).not.toBe('');
      expect(s.action.trim()).not.toBe('');
    }
  });

  /* Regression guards for the handlers these rows describe. Each one was read
     off the code (Step 2: ImageGrouper's keydown effects; Step 3: PDG's "."
     and Enter handlers) — if a handler is renamed or removed, the row must go
     with it, and these assertions are what makes that visible. */
  it('documents Enter as the Step 3 recording toggle, not a navigation key', () => {
    const enter = SHORTCUTS.find((s) => s.scope === 'step3' && s.keys === 'Enter');
    expect(enter?.action).toMatch(/record/i);
  });

  it('documents the "." dictation boundary as recording-only', () => {
    const period = SHORTCUTS.find((s) => s.scope === 'step3' && s.keys === '.');
    expect(period?.when).toMatch(/recording/i);
  });

  it('keeps the lightbox keys global — Step 2 and Step 3 both bind them', () => {
    expect(SHORTCUTS.find((s) => s.keys === '← →')?.scope).toBe('global');
    expect(SHORTCUTS.find((s) => s.keys === 'Esc')?.scope).toBe('global');
  });

  it('carries all nine Step 2 grouper bindings', () => {
    expect(shortcutsFor('step2').map((s) => s.keys)).toEqual([
      '⌘ Enter', '⌘ ⌫', '⌘ 1–9', '⌘ 0', '⌘ A', '⌘ Shift A', '⌘ D', '⌘ Z', '⌘ Shift Z',
    ]);
  });
});
