/**
 * The app's keyboard shortcuts, as data. Rendered by the ShortcutsPanel (the
 * gear button in the bottom-left corner) and nowhere else — a shortcut that
 * exists in code but not in this list is invisible to users, so every handler
 * that adds one must add a row here. `keys` use ⌘ for the platform modifier
 * (Ctrl on Windows/Linux — the panel substitutes it).
 *
 * Every row below was read back off its handler, not off a design doc:
 *   step2  → ImageGrouper.tsx (the six keydown effects around lines 1165–1275)
 *   step3  → ProductDescriptionGenerator.tsx ("." at ~1600, Esc/←/→/Enter at ~2340)
 *   global → the lightbox handlers in BOTH of those files
 */
export type ShortcutScope = 'step2' | 'step3' | 'global';

export interface Shortcut {
  keys: string;
  action: string;
  scope: ShortcutScope;
  /** When the shortcut is live, if it is not always. Rendered as dim trailing text. */
  when?: string;
}

export const SHORTCUT_SCOPE_LABEL: Record<ShortcutScope, string> = {
  step2: 'Step 2 · Group & categorize',
  step3: 'Step 3 · Describe',
  global: 'Everywhere',
};

/** Render order for the panel. Keyed off the label map so neither can drift. */
export const SHORTCUT_SCOPES: ShortcutScope[] = ['step2', 'step3', 'global'];

export const SHORTCUTS: Shortcut[] = [
  // ── Step 2 — ImageGrouper.tsx ────────────────────────────────────────────
  { keys: '⌘ Enter', action: 'Group selected photos', scope: 'step2' },
  { keys: '⌘ ⌫', action: 'Ungroup selected', scope: 'step2' },
  { keys: '⌘ 1–9', action: 'Set photos per item', scope: 'step2' },
  { keys: '⌘ 0', action: 'Set photos per item to 10', scope: 'step2' },
  { keys: '⌘ A', action: 'Select all singles', scope: 'step2', when: 'press again to deselect' },
  { keys: '⌘ Shift A', action: 'Select all groups', scope: 'step2', when: 'press again to deselect' },
  { keys: '⌘ D', action: 'Deselect everything', scope: 'step2' },
  { keys: '⌘ Z', action: 'Undo the last grouping change', scope: 'step2' },
  { keys: '⌘ Shift Z', action: 'Redo', scope: 'step2' },

  // ── Step 3 — ProductDescriptionGenerator.tsx ─────────────────────────────
  // Enter is a TOGGLE on the same button, not "next listing" — corrected after
  // reading handleStartRecording / handleStopRecording at the call site.
  { keys: 'Enter', action: 'Start / stop voice recording', scope: 'step3' },
  {
    keys: '.',
    action: 'End the field you are dictating (same as saying "period")',
    scope: 'step3',
    when: 'while recording',
  },

  // ── Everywhere ───────────────────────────────────────────────────────────
  // Both Step 2 and Step 3 mount a lightbox, and both bind these three keys.
  { keys: 'Esc', action: 'Close the crop tool, lightbox or open menu', scope: 'global' },
  { keys: '← →', action: 'Previous / next photo', scope: 'global', when: 'in the lightbox' },
];

/**
 * Typing anywhere wins: every handler above bails out when an input, textarea,
 * select or contenteditable has focus. Surfaced in the panel so nobody files
 * "⌘A stopped working" from inside a text field.
 */
export const SHORTCUT_FOOTNOTE =
  'Shortcuts pause while you are typing in a field.';

/** Shortcuts for one scope, in declaration order. */
export function shortcutsFor(scope: ShortcutScope): Shortcut[] {
  return SHORTCUTS.filter((s) => s.scope === scope);
}

/** Every scope that has at least one shortcut, in SHORTCUT_SCOPES order. */
export function groupedShortcuts(): { scope: ShortcutScope; label: string; items: Shortcut[] }[] {
  return SHORTCUT_SCOPES
    .map((scope) => ({ scope, label: SHORTCUT_SCOPE_LABEL[scope], items: shortcutsFor(scope) }))
    .filter((g) => g.items.length > 0);
}

/** "⌘" on Apple platforms, "Ctrl" elsewhere. */
export function platformKeys(keys: string, isMac: boolean): string {
  return isMac ? keys : keys.replace(/⌘/g, 'Ctrl');
}

/**
 * Split a `keys` string into the tokens the panel renders as separate <kbd>s.
 * Space-separated by construction ("⌘ Shift A"), except "← →" which is two
 * distinct keys that happen to be one concept.
 */
export function splitKeys(keys: string): string[] {
  return keys.split(' ').filter(Boolean);
}

/**
 * Is this an Apple platform? Takes the UA/platform string rather than reading
 * `navigator` so it stays pure and testable. Matches macOS, iPhone and iPad
 * (iPadOS reports "MacIntel", which the Mac test already covers).
 */
export function detectIsMac(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}
