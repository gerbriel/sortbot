/**
 * kanban/atlas — pure derivation for the board's "Atlas" view: the Feature
 * Atlas layout (features grouped by subsystem with status + wiring) rebuilt
 * LIVE from board state, so it stays in sync with lane drags and task ticks.
 *
 * The seed migration (supabase/migrations/seed_kanban_feature_atlas.sql) wrote
 * every card with a `[Tag] Name` title and a structured notes block:
 *
 *   <description>
 *
 *   Subsystem: <area>
 *   Atlas status at seed: <status>
 *
 *   Wiring:
 *   • <relationship line>
 *
 *   [seeded: feature-atlas 2026-07-19]
 *
 * Everything here parses that shape DEFENSIVELY — the view must degrade
 * gracefully as the team edits cards by hand (review findings, July 2026):
 *   * Tag matching is case/whitespace-insensitive ('[upload]' still files
 *     under Upload) and falls back to the notes' own 'Subsystem:' line when a
 *     title loses its tag, so routine retitling doesn't dump cards in 'Other'.
 *   * The wiring parser accepts •/-/–/* bullets and treats a plain line as a
 *     continuation of the previous bullet instead of silently dropping the
 *     rest of the block.
 *   * Each card gets a precomputed lowercase `haystack` (raw title, subsystem,
 *     description, wiring, ALL tasks incl. subtasks + their notes, lane name)
 *     so search is one .includes per card and can't miss fields the UI shows.
 * Cards with no recognizable subsystem land in an "Other" group with their
 * notes as the description — the view never depends on the seed having run.
 * Pure module, imports only from ./types; unit-tested in atlas.test.ts.
 */

import type { CardNode, ColumnNode, TaskNode } from './types';

// ── Subsystem registry (mirrors the seed's area → tag map) ──────────────────

export interface AtlasSubsystem {
  key: string;
  /** The `[Tag]` prefix the seed wrote into card titles. */
  tag: string;
  title: string;
  /** The full 'Subsystem: <area>' string the seed wrote into notes — the
   *  grouping fallback when a title loses its tag. */
  area: string;
  /** 'step' renders in the pipeline flow strip; 'xcut' below it. */
  kind: 'step' | 'xcut';
  /** Step number for the flow strip (steps only). */
  step?: string;
}

export const ATLAS_SUBSYSTEMS: AtlasSubsystem[] = [
  { key: 'upload',   tag: 'Upload',   title: 'Upload',                kind: 'step', step: '1', area: 'Step 1 — Image upload pipeline' },
  { key: 'group',    tag: 'Group',    title: 'Group & Categorize',    kind: 'step', step: '2', area: 'Step 2 — Grouping, categorization, presets application' },
  { key: 'describe', tag: 'Describe', title: 'Describe',              kind: 'step', step: '3', area: 'Step 3 — Voice, fields, description generation, crop tool' },
  { key: 'export',   tag: 'Export',   title: 'Save & Export',         kind: 'step', step: '4', area: 'Step 4 — Save batch + Shopify CSV export' },
  { key: 'library',  tag: 'Library',  title: 'Library & Persistence', kind: 'xcut', area: 'Library, batches, persistence & data-integrity machinery' },
  { key: 'accounts', tag: 'Accounts', title: 'Accounts & Admin',      kind: 'xcut', area: 'Auth, landing/beta gate, multi-org tenancy, admin panels' },
  { key: 'infra',    tag: 'Infra',    title: 'Infrastructure',        kind: 'xcut', area: 'Infrastructure, performance, debug, dead/unwired code' },
];

/** Group key for cards whose title carries no known `[Tag]` prefix. */
export const ATLAS_OTHER_KEY = 'other';

// ── Title parsing ───────────────────────────────────────────────────────────

/**
 * '[Upload] TUS resumable upload' → { tag: 'Upload', name: 'TUS resumable upload' }.
 * Matching is case- and whitespace-insensitive ('[upload]', '[ Upload ]',
 * '[Upload]NoSpace' all resolve) and always returns the CANONICAL tag, so
 * buildAtlas needs no second validation pass. Unknown or missing prefixes keep
 * the full title as the name (tag: null).
 */
export function splitAtlasTitle(title: string): { tag: string | null; name: string } {
  const m = /^\[([^\]]+)\]\s*(.+)$/.exec(title);
  if (!m) return { tag: null, name: title };
  const wanted = m[1].trim().toLowerCase();
  const sub = ATLAS_SUBSYSTEMS.find(s => s.tag.toLowerCase() === wanted);
  return sub ? { tag: sub.tag, name: m[2] } : { tag: null, name: title };
}

// ── Notes parsing ───────────────────────────────────────────────────────────

export interface AtlasNotes {
  description: string;
  /** Relationship lines from the 'Wiring:' block, bullets stripped. */
  wiring: string[];
  /** Value of the 'Subsystem: <area>' line — the grouping fallback when the
   *  title has no tag. Null when the notes don't carry one. */
  subsystemArea: string | null;
  /** True when the card came from the feature-atlas seed migration. */
  seeded: boolean;
}

/** Bullet glyphs the wiring parser accepts — teammates editing notes in the
 *  drawer will not reliably type '•'. */
const WIRING_BULLET_RE = /^[•\-–*]\s*/;

export function parseAtlasNotes(notes: string | null): AtlasNotes {
  if (!notes) return { description: '', wiring: [], subsystemArea: null, seeded: false };
  const lines = notes.split('\n');
  const seeded = notes.includes('[seeded: feature-atlas');

  const subsystemLine = lines.find(l => /^Subsystem:\s/.test(l));
  const subsystemArea = subsystemLine ? subsystemLine.replace(/^Subsystem:\s*/, '').trim() || null : null;

  // The description ends where the structured block begins — whichever of the
  // marker lines appears first. A hand-written note has none of them, so the
  // whole text is the description.
  const stops = [
    lines.findIndex(l => /^Subsystem:\s/.test(l)),
    lines.findIndex(l => l.trim() === 'Wiring:'),
    lines.findIndex(l => l.startsWith('[seeded:')),
  ].filter(i => i >= 0);
  const descEnd = stops.length ? Math.min(...stops) : lines.length;
  const description = lines.slice(0, descEnd).join('\n').trim();

  // Wiring block: bullets push entries; blanks are skipped; the seed marker
  // ends the block; any other line is treated as a CONTINUATION of the
  // previous bullet (wrapped/edited text) rather than silently dropping the
  // rest of the block — drawer edits must degrade gracefully.
  const wiringIdx = lines.findIndex(l => l.trim() === 'Wiring:');
  const wiring: string[] = [];
  if (wiringIdx >= 0) {
    for (let i = wiringIdx + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l === '') continue;
      if (l.startsWith('[seeded:')) break;
      if (WIRING_BULLET_RE.test(l)) wiring.push(l.replace(WIRING_BULLET_RE, ''));
      else if (wiring.length) wiring[wiring.length - 1] += ' ' + l;
      else break; // prose before the first bullet — not a wiring block
    }
  }
  return { description, wiring, subsystemArea, seeded };
}

// ── Lane → status key (drives the pill colour in the view) ──────────────────

/** Stable CSS-modifier key for a lane. is_done wins (any custom "finished"
 *  lane reads as done); the four default lanes map by name; anything else is
 *  'custom' so a renamed/added lane still gets a neutral pill. */
export function laneKey(name: string, isDone: boolean): string {
  if (isDone) return 'done';
  switch (name.trim().toLowerCase()) {
    case 'backlog':     return 'backlog';
    case 'to do':       return 'todo';
    case 'in progress': return 'inprogress';
    case 'in review':   return 'inreview';
    default:            return 'custom';
  }
}

// ── Atlas assembly ──────────────────────────────────────────────────────────

export interface AtlasCard {
  card: CardNode;
  /** Title with the `[Tag]` prefix stripped. */
  name: string;
  laneName: string;
  laneKey: string;
  notes: AtlasNotes;
  /** Precomputed lowercase search text: raw title + subsystem + description +
   *  wiring + every task AND subtask title/notes + lane name. Search is one
   *  .includes against this — never rebuilt per keystroke. */
  haystack: string;
}

export interface AtlasGroup extends AtlasSubsystem {
  cards: AtlasCard[];
}

/** Depth-first task walk (tasks + subtasks) for the search haystack. */
function taskText(tasks: TaskNode[]): string {
  let out = '';
  for (const t of tasks) {
    out += ' ' + t.title;
    if (t.notes) out += ' ' + t.notes;
    if (t.subtasks.length) out += taskText(t.subtasks);
  }
  return out;
}

/**
 * Regroup the lane tree into subsystem groups. All seven subsystems are always
 * returned (a zero count is real data for the flow strip); the 'Other' group is
 * appended only when unmatched cards exist. Grouping resolves the title tag
 * first, then the notes' 'Subsystem:' line — so a seeded card keeps its section
 * even after someone strips the bracket from its title. Within a group, cards
 * keep lane order then rank order — the tree's own ordering — so the section
 * reads Backlog → … → Done top to bottom.
 */
export function buildAtlas(tree: ColumnNode[]): AtlasGroup[] {
  const groups: AtlasGroup[] = ATLAS_SUBSYSTEMS.map(s => ({ ...s, cards: [] }));
  const byTag = new Map(groups.map(g => [g.tag, g]));
  const byArea = new Map(groups.map(g => [g.area.toLowerCase(), g]));
  const other: AtlasGroup = { key: ATLAS_OTHER_KEY, tag: '', area: '', title: 'Other cards', kind: 'xcut', cards: [] };

  for (const column of tree) {
    const lk = laneKey(column.name, column.is_done);
    for (const card of column.cards) {
      const { tag, name } = splitAtlasTitle(card.title);
      const notes = parseAtlasNotes(card.notes);
      const target =
        (tag && byTag.get(tag))
        || (notes.subsystemArea && byArea.get(notes.subsystemArea.toLowerCase()))
        || other;
      target.cards.push({
        card,
        name,
        laneName: column.name,
        laneKey: lk,
        notes,
        haystack: (
          card.title + ' ' + target.title + ' ' + target.area + ' '
          + notes.description + ' ' + notes.wiring.join(' ')
          + taskText(card.tasks) + ' ' + column.name
        ).toLowerCase(),
      });
    }
  }
  return other.cards.length ? [...groups, other] : groups;
}
