import { describe, it, expect } from 'vitest';
import {
  ATLAS_OTHER_KEY,
  ATLAS_SUBSYSTEMS,
  buildAtlas,
  laneKey,
  parseAtlasNotes,
  splitAtlasTitle,
} from './atlas';
import type { CardNode, ColumnNode, TaskNode } from './types';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeTask(over: Partial<TaskNode> & { id: string; card_id: string; title: string }): TaskNode {
  return {
    parent_task_id: null,
    notes: null,
    status: 'todo',
    rank: 1000,
    assignee_ids: [],
    start_date: null,
    due_date: null,
    end_date: null,
    completed_at: null,
    created_by: null,
    created_at: '2026-07-19T00:00:00Z',
    updated_at: '2026-07-19T00:00:00Z',
    subtasks: [],
    assignees: [],
    comments: [],
    ...over,
  };
}

function makeCard(over: Partial<CardNode> & { id: string; column_id: string; title: string }): CardNode {
  return {
    notes: null,
    is_epic: false,
    rank: 1000,
    assignee_ids: [],
    start_date: null,
    due_date: null,
    end_date: null,
    completed_at: null,
    created_by: null,
    created_by_email: null,
    created_at: '2026-07-19T00:00:00Z',
    updated_at: '2026-07-19T00:00:00Z',
    tasks: [],
    assignees: [],
    comments: [],
    ...over,
  };
}

function makeColumn(over: Partial<ColumnNode> & { id: string; name: string }): ColumnNode {
  return { rank: 1000, is_done: false, cards: [], ...over };
}

/** The exact notes shape the seed migration wrote. */
const SEEDED_NOTES = [
  'react-dropzone zone in Step 1 accepting JPG/PNG/WEBP files.',
  '',
  'Subsystem: Step 1 — Image upload pipeline',
  'Atlas status at seed: done',
  '',
  'Wiring:',
  '• feeds: chunked upload pipeline (processFiles)',
  '• depends on: react-dropzone',
  '',
  '[seeded: feature-atlas 2026-07-19]',
].join('\n');

// ── splitAtlasTitle ─────────────────────────────────────────────────────────

describe('splitAtlasTitle', () => {
  it('splits every known subsystem tag', () => {
    for (const s of ATLAS_SUBSYSTEMS) {
      expect(splitAtlasTitle(`[${s.tag}] Some feature`)).toEqual({ tag: s.tag, name: 'Some feature' });
    }
  });

  it('matches tags case- and whitespace-insensitively, returning the canonical tag', () => {
    expect(splitAtlasTitle('[upload] Fix EXIF retry')).toEqual({ tag: 'Upload', name: 'Fix EXIF retry' });
    expect(splitAtlasTitle('[ Upload ] Retry logic')).toEqual({ tag: 'Upload', name: 'Retry logic' });
    expect(splitAtlasTitle('[INFRA]No space after bracket')).toEqual({ tag: 'Infra', name: 'No space after bracket' });
  });

  it('keeps unknown bracket prefixes as part of the name', () => {
    expect(splitAtlasTitle('[Urgent] Fix the thing')).toEqual({ tag: null, name: '[Urgent] Fix the thing' });
  });

  it('passes untagged titles through unchanged', () => {
    expect(splitAtlasTitle('Ship the new landing page')).toEqual({ tag: null, name: 'Ship the new landing page' });
  });
});

// ── parseAtlasNotes ─────────────────────────────────────────────────────────

describe('parseAtlasNotes', () => {
  it('parses the seeded shape: description, wiring bullets, subsystem area, seeded flag', () => {
    const parsed = parseAtlasNotes(SEEDED_NOTES);
    expect(parsed.description).toBe('react-dropzone zone in Step 1 accepting JPG/PNG/WEBP files.');
    expect(parsed.wiring).toEqual([
      'feeds: chunked upload pipeline (processFiles)',
      'depends on: react-dropzone',
    ]);
    expect(parsed.subsystemArea).toBe('Step 1 — Image upload pipeline');
    expect(parsed.seeded).toBe(true);
  });

  it('treats hand-written notes as pure description', () => {
    const parsed = parseAtlasNotes('Just a note a teammate typed.\nSecond line.');
    expect(parsed.description).toBe('Just a note a teammate typed.\nSecond line.');
    expect(parsed.wiring).toEqual([]);
    expect(parsed.subsystemArea).toBeNull();
    expect(parsed.seeded).toBe(false);
  });

  it('handles null and empty notes', () => {
    expect(parseAtlasNotes(null)).toEqual({ description: '', wiring: [], subsystemArea: null, seeded: false });
    expect(parseAtlasNotes('')).toEqual({ description: '', wiring: [], subsystemArea: null, seeded: false });
  });

  it('accepts -, – and * bullets in the wiring block (drawer edits)', () => {
    const parsed = parseAtlasNotes('Desc.\n\nWiring:\n• a: b\n- c: d\n– e: f\n* g: h');
    expect(parsed.wiring).toEqual(['a: b', 'c: d', 'e: f', 'g: h']);
  });

  it('treats a plain line after a bullet as a continuation, not a block terminator', () => {
    const parsed = parseAtlasNotes(
      'Desc.\n\nWiring:\n• depends on: something long\nthat wrapped onto a second line\n• feeds: another\n\n[seeded: feature-atlas 2026-07-19]',
    );
    expect(parsed.wiring).toEqual([
      'depends on: something long that wrapped onto a second line',
      'feeds: another',
    ]);
    expect(parsed.seeded).toBe(true);
  });

  it('does not treat prose before the first bullet as wiring', () => {
    const parsed = parseAtlasNotes('Desc.\n\nWiring:\nno bullets here at all');
    expect(parsed.wiring).toEqual([]);
  });

  it('stops the wiring block at the seed marker', () => {
    const parsed = parseAtlasNotes('Desc.\n\nWiring:\n• a: b\n\n[seeded: feature-atlas 2026-07-19]');
    expect(parsed.wiring).toEqual(['a: b']);
  });
});

// ── laneKey ─────────────────────────────────────────────────────────────────

describe('laneKey', () => {
  it('maps the default lanes by name and is_done wins over name', () => {
    expect(laneKey('Backlog', false)).toBe('backlog');
    expect(laneKey('To do', false)).toBe('todo');
    expect(laneKey('In progress', false)).toBe('inprogress');
    expect(laneKey('In review', false)).toBe('inreview');
    expect(laneKey('Done', true)).toBe('done');
    // a custom "finished" lane still reads as done
    expect(laneKey('Shipped 🚀', true)).toBe('done');
  });

  it('unknown non-done lanes get the neutral key', () => {
    expect(laneKey('Icebox', false)).toBe('custom');
  });
});

// ── buildAtlas ──────────────────────────────────────────────────────────────

describe('buildAtlas', () => {
  const done = makeColumn({ id: 'col-done', name: 'Done', rank: 5000, is_done: true });
  const backlog = makeColumn({ id: 'col-bl', name: 'Backlog', rank: 1000 });

  it('groups tagged cards under their subsystem, keeping lane order within a group', () => {
    const tree: ColumnNode[] = [
      { ...backlog, cards: [makeCard({ id: 'c1', column_id: 'col-bl', title: '[Upload] Old compressor' })] },
      { ...done, cards: [makeCard({ id: 'c2', column_id: 'col-done', title: '[Upload] TUS resumable upload', notes: SEEDED_NOTES })] },
    ];
    const atlas = buildAtlas(tree);
    const upload = atlas.find(g => g.key === 'upload')!;
    expect(upload.cards.map(c => c.card.id)).toEqual(['c1', 'c2']); // lane order: Backlog before Done
    expect(upload.cards[0].laneKey).toBe('backlog');
    expect(upload.cards[1].laneKey).toBe('done');
    expect(upload.cards[1].name).toBe('TUS resumable upload');
    expect(upload.cards[1].notes.seeded).toBe(true);
  });

  it('always returns all seven subsystems, even empty (zero counts are real data)', () => {
    const atlas = buildAtlas([]);
    expect(atlas.map(g => g.key)).toEqual(ATLAS_SUBSYSTEMS.map(s => s.key));
    expect(atlas.every(g => g.cards.length === 0)).toBe(true);
  });

  it("falls back to the notes' Subsystem line when the title lost its tag", () => {
    // The retitle-erosion case: a teammate strips '[Export] ' from a seeded
    // card — the notes still name the subsystem, so it must NOT drop to Other.
    const tree: ColumnNode[] = [
      { ...backlog, cards: [makeCard({
        id: 'c1', column_id: 'col-bl', title: 'CSV price gate',
        notes: 'Desc.\n\nSubsystem: Step 4 — Save batch + Shopify CSV export\n\n[seeded: feature-atlas 2026-07-19]',
      })] },
    ];
    const atlas = buildAtlas(tree);
    expect(atlas.find(g => g.key === 'export')!.cards.map(c => c.name)).toEqual(['CSV price gate']);
    expect(atlas.some(g => g.key === ATLAS_OTHER_KEY)).toBe(false);
  });

  it('routes untagged and unknown-tag cards to an Other group appended last', () => {
    const tree: ColumnNode[] = [
      { ...backlog, cards: [
        makeCard({ id: 'c1', column_id: 'col-bl', title: 'Hand-added card' }),
        makeCard({ id: 'c2', column_id: 'col-bl', title: '[Urgent] Not a subsystem' }),
      ] },
    ];
    const atlas = buildAtlas(tree);
    const otherGroup = atlas[atlas.length - 1];
    expect(otherGroup.key).toBe(ATLAS_OTHER_KEY);
    expect(otherGroup.cards.map(c => c.name)).toEqual(['Hand-added card', '[Urgent] Not a subsystem']);
  });

  it('omits the Other group when every card is tagged', () => {
    const tree: ColumnNode[] = [
      { ...done, cards: [makeCard({ id: 'c1', column_id: 'col-done', title: '[Infra] Service Worker image cache' })] },
    ];
    expect(buildAtlas(tree).some(g => g.key === ATLAS_OTHER_KEY)).toBe(false);
  });

  it('precomputes a lowercase haystack covering raw title, subsystem, wiring, subtasks and lane', () => {
    const sub = makeTask({ id: 't2', card_id: 'c1', title: 'Signed URLs', parent_task_id: 't1', notes: 'bucket privacy' });
    const task = makeTask({ id: 't1', card_id: 'c1', title: 'Storage hardening', subtasks: [sub] });
    const tree: ColumnNode[] = [
      { ...backlog, cards: [makeCard({
        id: 'c1', column_id: 'col-bl', title: '[Accounts] Beta waitlist gate',
        notes: SEEDED_NOTES, tasks: [task],
      })] },
    ];
    const hay = buildAtlas(tree).find(g => g.key === 'accounts')!.cards[0].haystack;
    expect(hay).toContain('[accounts]');          // raw title incl. tag
    expect(hay).toContain('accounts & admin');    // group title
    expect(hay).toContain('signed urls');         // SUBTASK title
    expect(hay).toContain('bucket privacy');      // subtask notes
    expect(hay).toContain('storage hardening');   // task title
    expect(hay).toContain('backlog');             // lane name
    expect(hay).toContain('react-dropzone');      // wiring text
    expect(hay).toBe(hay.toLowerCase());
  });
});
