import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import SimilarListings from './SimilarListings';
import type { SimilarListingsProps } from './SimilarListings';
import { mount, cleanup, click, one, all, buttonByText } from './ui/testUtils';
import {
  embeddingsAvailable,
  ensureEmbeddings,
  fetchEmbeddedPhotoIds,
  findSimilar,
  pollEmbedJob,
  type SimilarListing,
} from '../lib/embeddingsService';

/**
 * The strip.
 *
 * WHAT IS WORTH ASSERTING HERE is not the markup — it is the four things the
 * component decides, each of which is a judgement a rule cannot make:
 *
 *   1. IT PUTS ITSELF AWAY. No service, no migration, no workspace → no element.
 *      That is what lets this ship before `listing_embeddings.sql` is run, and it
 *      has to hold even when the reads REJECT, because this sits inside Step 3
 *      and a throw there takes the dictation screen with it.
 *   2. AN EMPTY RESULT HAS TWO MEANINGS. "Never analysed" offers a button;
 *      "nothing like it" says so. Getting those the wrong way round either hides
 *      the only affordance the feature has, or offers a button that does nothing.
 *   3. THE DUPLICATE CLAIM IS LOUD AND IN THE ACCESSIBILITY TREE. "You already
 *      listed this" is the one thing here a seller must act on.
 *   4. POLLING ENDS. The service answers 202 and works afterwards, so a bug in
 *      the loop is a component that spins forever inside the editor.
 *
 * Only the IO is mocked; the pure formatting (`formatSoldLine`, `formatPrice`,
 * `isNearDuplicate`) stays real, because the words on screen ARE the contract.
 */

vi.mock('../lib/embeddingsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/embeddingsService')>();
  return {
    ...actual,
    embeddingsAvailable: vi.fn(),
    findSimilar: vi.fn(),
    fetchEmbeddedPhotoIds: vi.fn(),
    ensureEmbeddings: vi.fn(),
    pollEmbedJob: vi.fn(),
  };
});

const daysAgoIso = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

function match(over: Partial<SimilarListing> = {}): SimilarListing {
  return {
    productImageId: 'img-1',
    productId: 'prod-1',
    productGroupId: 'group-1',
    batchId: 'batch-7',
    similarity: 0.84,
    label: 'similar',
    title: 'Vintage Carhartt chore coat',
    price: 45,
    soldPriceCents: null,
    soldAt: null,
    thumbnailUrl: 'https://cdn.test/u/p/a.jpg',
    ...over,
  };
}

function props(over: Partial<SimilarListingsProps> = {}): SimilarListingsProps {
  return { productImageId: 'img-query', orgId: 'org-1', ...over };
}

/** mount + let the availability probe and the reads settle. */
async function render(over: Partial<SimilarListingsProps> = {}) {
  const p = props(over);
  const view = mount(<SimilarListings {...p} />);
  await settle();
  return { ...view, p };
}

async function settle(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

beforeEach(() => {
  vi.mocked(embeddingsAvailable).mockResolvedValue(true);
  vi.mocked(findSimilar).mockResolvedValue({ status: 'ok', rows: [] });
  vi.mocked(fetchEmbeddedPhotoIds).mockResolvedValue({ status: 'ok', ids: new Set(['img-query']) });
  vi.mocked(ensureEmbeddings).mockResolvedValue({ ok: true, value: { jobId: '', accepted: 0, skipped: 1 } });
  vi.mocked(pollEmbedJob).mockResolvedValue({
    ok: true,
    value: { jobId: 'j1', status: 'done', total: 1, done: 1, failed: 0, review: 0, auto: 1 },
  });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

// ── 1. it puts itself away ──────────────────────────────────────────────────

describe('hiding itself', () => {
  it('renders NOTHING when the feature is unavailable', async () => {
    vi.mocked(embeddingsAvailable).mockResolvedValue(false);
    const { container } = await render();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing and asks NOTHING when there is no workspace', async () => {
    const { container } = await render({ orgId: null });
    expect(container.innerHTML).toBe('');
    expect(embeddingsAvailable).not.toHaveBeenCalled();
    expect(findSimilar).not.toHaveBeenCalled();
  });

  it('renders nothing with no photo id', async () => {
    const { container } = await render({ productImageId: '' });
    expect(container.innerHTML).toBe('');
    expect(findSimilar).not.toHaveBeenCalled();
  });

  it('renders nothing while the reads are in flight, rather than an empty frame', () => {
    const view = mount(<SimilarListings {...props()} />);
    expect(view.container.innerHTML).toBe('');
  });

  it('hides itself when the RPC reports the migration has not been run', async () => {
    vi.mocked(findSimilar).mockResolvedValue({ status: 'unavailable' });
    const { container } = await render();
    expect(container.innerHTML).toBe('');
  });

  it('hides itself when the "is it analysed" read is unavailable too', async () => {
    vi.mocked(fetchEmbeddedPhotoIds).mockResolvedValue({ status: 'unavailable' });
    const { container } = await render();
    expect(container.innerHTML).toBe('');
  });
});

// ── the strip ───────────────────────────────────────────────────────────────

describe('the matches', () => {
  it('renders a card per match with its title, price and similarity word', async () => {
    vi.mocked(findSimilar).mockResolvedValue({
      status: 'ok',
      rows: [
        match(),
        match({ productImageId: 'img-2', title: 'Levi 501', price: 60, similarity: 0.78, label: 'similar' }),
      ],
    });
    const { container } = await render();
    expect(all(container, '.sl-item')).toHaveLength(2);
    expect(all(container, '.sl-card-title').map(e => e.textContent))
      .toEqual(['Vintage Carhartt chore coat', 'Levi 501']);
    expect(all(container, '.sl-price').map(e => e.textContent)).toEqual(['$45.00', '$60.00']);
    expect(all(container, '.sl-badge').map(e => e.textContent)).toEqual(['similar', 'similar']);
    expect(one(container, '.sl-head-text').textContent).toBe('Similar past listings');
  });

  it('asks for the photo id it was given, not a product id', async () => {
    await render({ productImageId: 'img-abc' });
    expect(findSimilar).toHaveBeenCalledWith('img-abc', expect.any(Number));
  });

  it('shows at most eight cards even when the RPC returns more', async () => {
    vi.mocked(findSimilar).mockResolvedValue({
      status: 'ok',
      rows: Array.from({ length: 14 }, (_, i) => match({ productImageId: `img-${i}` })),
    });
    const { container } = await render();
    expect(all(container, '.sl-item')).toHaveLength(8);
  });

  it('uses the thumbnail url the service resolved, and falls back to a placeholder', async () => {
    vi.mocked(findSimilar).mockResolvedValue({
      status: 'ok',
      rows: [match(), match({ productImageId: 'img-2', thumbnailUrl: '' })],
    });
    const { container } = await render();
    expect(one(container, '.sl-item img').getAttribute('src')).toBe('https://cdn.test/u/p/a.jpg');
    expect(one(container, '.sl-item img').getAttribute('loading')).toBe('lazy');
    // No <img> for the second card, a placeholder box instead: a broken image icon
    // in a strip of garments reads as "this listing is broken".
    expect(all(container, '.sl-thumb-empty')).toHaveLength(1);
    expect(all(container, '.sl-item img')).toHaveLength(1);
  });

  it('drops an empty title into a placeholder rather than an unlabelled card', async () => {
    // The service already does this; asserted here so the two cannot disagree.
    vi.mocked(findSimilar).mockResolvedValue({ status: 'ok', rows: [match({ title: 'Untitled listing' })] });
    const { container } = await render();
    expect(one(container, '.sl-card-title').textContent).toBe('Untitled listing');
  });

  it('omits the price entirely when there is none — never "$0.00" beside a comp', async () => {
    vi.mocked(findSimilar).mockResolvedValue({ status: 'ok', rows: [match({ price: null })] });
    const { container } = await render();
    expect(all(container, '.sl-price')).toHaveLength(0);
  });
});

// ── the sold line ───────────────────────────────────────────────────────────

describe('what it sold for', () => {
  it('prints the sold price and how long ago', async () => {
    vi.mocked(findSimilar).mockResolvedValue({
      status: 'ok',
      rows: [match({ soldPriceCents: 1800, soldAt: daysAgoIso(30) })],
    });
    const { container } = await render();
    expect(one(container, '.sl-sold').textContent).toBe('sold $18.00 · 30 days ago');
  });

  it('says "not sold yet" rather than nothing — which is every row before pricing_research.sql runs', async () => {
    vi.mocked(findSimilar).mockResolvedValue({ status: 'ok', rows: [match()] });
    const { container } = await render();
    expect(one(container, '.sl-unsold').textContent).toBe('not sold yet');
    expect(all(container, '.sl-sold')).toHaveLength(0);
  });
});

// ── the duplicate claim ─────────────────────────────────────────────────────

describe('duplicate detection', () => {
  it('warns in the header AND on the card when a match is the same garment', async () => {
    vi.mocked(findSimilar).mockResolvedValue({
      status: 'ok',
      rows: [match({ similarity: 0.9837, label: 'near duplicate' }), match({ productImageId: 'img-2' })],
    });
    const { container } = await render();
    expect(one(container, '.sl-dup-chip').textContent).toContain('Possible duplicate');
    // A real element, not a title attribute or a pseudo-element: it has to be in
    // the accessibility tree and survive a copy-paste.
    expect(all(container, '.sl-card-dup')).toHaveLength(1);
    expect(one(container, '.sl-card-dup').textContent).toBe('Looks like the same garment');
  });

  it('counts them when there is more than one', async () => {
    vi.mocked(findSimilar).mockResolvedValue({
      status: 'ok',
      rows: [
        match({ similarity: 0.99, label: 'near duplicate' }),
        match({ productImageId: 'img-2', similarity: 0.94, label: 'near duplicate' }),
      ],
    });
    const { container } = await render();
    expect(one(container, '.sl-dup-chip').textContent).toContain('2 possible duplicates');
  });

  it('says nothing when every match is merely similar — the threshold is a claim, not decoration', async () => {
    vi.mocked(findSimilar).mockResolvedValue({
      status: 'ok',
      rows: [match({ similarity: 0.9199 }), match({ productImageId: 'img-2', similarity: 0.7 })],
    });
    const { container } = await render();
    expect(all(container, '.sl-dup-chip')).toHaveLength(0);
    expect(all(container, '.sl-card-dup')).toHaveLength(0);
  });

  it('reads the similarity, not the label the row happens to carry', async () => {
    // A stale or hand-built label must not be able to claim a duplicate.
    vi.mocked(findSimilar).mockResolvedValue({
      status: 'ok',
      rows: [match({ similarity: 0.5, label: 'near duplicate' })],
    });
    const { container } = await render();
    expect(all(container, '.sl-dup-chip')).toHaveLength(0);
  });
});

// ── opening a match ─────────────────────────────────────────────────────────

describe('opening a match', () => {
  it('makes the card a button and hands back the group AND the batch', async () => {
    const onOpen = vi.fn();
    vi.mocked(findSimilar).mockResolvedValue({
      status: 'ok',
      rows: [match({ productGroupId: 'group-9', batchId: 'batch-3' })],
    });
    const { container } = await render({ onOpen });
    click(one(container, '.sl-card--open'));
    expect(onOpen).toHaveBeenCalledWith('group-9', 'batch-3');
  });

  it('still opens a listing that is in no batch, with a null batch id', async () => {
    const onOpen = vi.fn();
    vi.mocked(findSimilar).mockResolvedValue({
      status: 'ok',
      rows: [match({ productGroupId: 'group-9', batchId: null })],
    });
    const { container } = await render({ onOpen });
    click(one(container, '.sl-card--open'));
    expect(onOpen).toHaveBeenCalledWith('group-9', null);
  });

  it('is not interactive without onOpen — a dead button is worse than a card', async () => {
    vi.mocked(findSimilar).mockResolvedValue({ status: 'ok', rows: [match()] });
    const { container } = await render();
    expect(all(container, '.sl-card--open')).toHaveLength(0);
    expect(all(container, '.sl-strip button')).toHaveLength(0);
  });

  it('is not interactive for a match with no group id, even with onOpen', async () => {
    vi.mocked(findSimilar).mockResolvedValue({ status: 'ok', rows: [match({ productGroupId: null })] });
    const { container } = await render({ onOpen: vi.fn() });
    expect(all(container, '.sl-card--open')).toHaveLength(0);
  });
});

// ── 2. an empty result has two meanings ─────────────────────────────────────

describe('nothing to show', () => {
  it('says so when the photo HAS been analysed and there is simply nothing like it', async () => {
    vi.mocked(fetchEmbeddedPhotoIds).mockResolvedValue({ status: 'ok', ids: new Set(['img-query']) });
    const { container } = await render();
    expect(one(container, '.sl-note').textContent)
      .toBe('Nothing in this workspace looks like this one yet.');
    expect(() => buttonByText(container, 'Find similar')).toThrow();
  });

  it('offers Find similar when the photo has NEVER been analysed', async () => {
    vi.mocked(fetchEmbeddedPhotoIds).mockResolvedValue({ status: 'ok', ids: new Set() });
    const { container } = await render();
    expect(buttonByText(container, 'Find similar')).toBeTruthy();
    expect(all(container, '.sl-item')).toHaveLength(0);
  });

  it('only asks WHY when there is nothing to show — a hit costs one read fewer', async () => {
    vi.mocked(findSimilar).mockResolvedValue({ status: 'ok', rows: [match()] });
    await render();
    expect(fetchEmbeddedPhotoIds).not.toHaveBeenCalled();
  });
});

// ── the Find similar path ───────────────────────────────────────────────────

describe('Find similar', () => {
  beforeEach(() => {
    vi.mocked(fetchEmbeddedPhotoIds).mockResolvedValue({ status: 'ok', ids: new Set() });
  });

  it('embeds EVERY photo of the listing when the caller supplies them', async () => {
    const { container } = await render({
      productImageIds: ['img-query', 'img-2', 'img-3'],
    });
    click(buttonByText(container, 'Find similar'));
    await settle();
    expect(ensureEmbeddings).toHaveBeenCalledWith(['img-query', 'img-2', 'img-3']);
  });

  it('embeds just the one photo when the caller does not know the rest', async () => {
    const { container } = await render();
    click(buttonByText(container, 'Find similar'));
    await settle();
    expect(ensureEmbeddings).toHaveBeenCalledWith(['img-query']);
  });

  it('re-reads IMMEDIATELY when nothing needed embedding, without a poll', async () => {
    vi.mocked(ensureEmbeddings).mockResolvedValue({
      ok: true, value: { jobId: '', accepted: 0, skipped: 1 },
    });
    vi.mocked(findSimilar)
      .mockResolvedValueOnce({ status: 'ok', rows: [] })
      .mockResolvedValue({ status: 'ok', rows: [match()] });
    const { container } = await render();
    click(buttonByText(container, 'Find similar'));
    await settle();
    expect(pollEmbedJob).not.toHaveBeenCalled();
    expect(all(container, '.sl-item')).toHaveLength(1);
  });

  it('polls a real job, then shows the matches', async () => {
    vi.useFakeTimers();
    vi.mocked(ensureEmbeddings).mockResolvedValue({
      ok: true, value: { jobId: 'job-1', accepted: 2, skipped: 0 },
    });
    vi.mocked(pollEmbedJob)
      .mockResolvedValueOnce({ ok: true, value: { jobId: 'job-1', status: 'running', total: 2, done: 1, failed: 0, review: 0, auto: 1 } })
      .mockResolvedValue({ ok: true, value: { jobId: 'job-1', status: 'done', total: 2, done: 2, failed: 0, review: 0, auto: 2 } });
    vi.mocked(findSimilar)
      .mockResolvedValueOnce({ status: 'ok', rows: [] })
      .mockResolvedValue({ status: 'ok', rows: [match()] });

    const view = mount(<SimilarListings {...props()} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    click(buttonByText(view.container, 'Find similar'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(one(view.container, '.sl-note').textContent).toContain('Analysing this listing');

    // First tick: still running, and the progress is shown.
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(one(view.container, '.sl-note').textContent).toContain('1/2');
    // Second tick: done, and the strip appears.
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(all(view.container, '.sl-item')).toHaveLength(1);
    expect(pollEmbedJob).toHaveBeenCalledTimes(2);
  });

  it('re-reads rather than reporting a failure when the job id is GONE', async () => {
    // The service restarted and lost its counter; the rows it had already written
    // are still there, so looking again is the right move.
    vi.useFakeTimers();
    vi.mocked(ensureEmbeddings).mockResolvedValue({
      ok: true, value: { jobId: 'job-1', accepted: 1, skipped: 0 },
    });
    vi.mocked(pollEmbedJob).mockResolvedValue({ ok: false, error: 'unknown job', status: 404 });
    vi.mocked(findSimilar)
      .mockResolvedValueOnce({ status: 'ok', rows: [] })
      .mockResolvedValue({ status: 'ok', rows: [match()] });

    const view = mount(<SimilarListings {...props()} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    click(buttonByText(view.container, 'Find similar'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(all(view.container, '.sl-item')).toHaveLength(1);
  });

  it('names the migration when the service says 503, and keeps the button', async () => {
    vi.mocked(ensureEmbeddings).mockResolvedValue({
      ok: false, error: 'Run supabase/migrations/listing_embeddings.sql to turn this on.', status: 503,
    });
    const { container } = await render();
    click(buttonByText(container, 'Find similar'));
    await settle();
    expect(one(container, '.sl-note--warn').textContent).toContain('listing_embeddings.sql');
    expect(buttonByText(container, 'Find similar')).toBeTruthy();
  });

  it('shows an unreachable service as a warning rather than disappearing', async () => {
    vi.mocked(ensureEmbeddings).mockResolvedValue({ ok: false, error: 'Could not reach the service.' });
    const { container } = await render();
    click(buttonByText(container, 'Find similar'));
    await settle();
    expect(one(container, '.sl-note--warn').textContent).toBe('Could not reach the service.');
  });

  it('gives up rather than polling forever', async () => {
    vi.useFakeTimers();
    vi.mocked(ensureEmbeddings).mockResolvedValue({
      ok: true, value: { jobId: 'job-1', accepted: 1, skipped: 0 },
    });
    vi.mocked(pollEmbedJob).mockResolvedValue({
      ok: true, value: { jobId: 'job-1', status: 'running', total: 1, done: 0, failed: 0, review: 0, auto: 0 },
    });
    const view = mount(<SimilarListings {...props()} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    click(buttonByText(view.container, 'Find similar'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500 * 45); });
    expect(one(view.container, '.sl-note--warn').textContent).toContain('longer than expected');
    // And the loop really stopped, rather than being merely invisible.
    const before = vi.mocked(pollEmbedJob).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(1500 * 10); });
    expect(vi.mocked(pollEmbedJob).mock.calls.length).toBe(before);
  });
});

// ── an error from the read ──────────────────────────────────────────────────

describe('a failed read', () => {
  it('shows the message and offers a retry rather than an empty frame', async () => {
    vi.mocked(findSimilar).mockResolvedValue({ status: 'error', error: 'permission denied' });
    const { container } = await render();
    expect(one(container, '.sl-note--warn').textContent).toBe('permission denied');
    expect(buttonByText(container, 'Find similar')).toBeTruthy();
  });
});

// ── re-keying and teardown ──────────────────────────────────────────────────

describe('changing photo', () => {
  it('re-asks when the photo changes', async () => {
    const view = await render();
    view.rerender(<SimilarListings {...props({ productImageId: 'img-other' })} />);
    await settle();
    expect(vi.mocked(findSimilar).mock.calls.map(c => c[0])).toEqual(['img-query', 'img-other']);
  });

  it('re-asks when the workspace changes, so the previous shop is never shown', async () => {
    const view = await render();
    view.rerender(<SimilarListings {...props({ orgId: 'org-2' })} />);
    await settle();
    expect(vi.mocked(findSimilar)).toHaveBeenCalledTimes(2);
  });

  it('does not re-ask when only the parent re-rendered with the same ids', async () => {
    const view = await render({ productImageIds: ['img-query', 'img-2'] });
    // A FRESH array with the same contents — which is what Step 3 hands it on
    // every keystroke. The fetch is keyed on the photo, not on array identity.
    view.rerender(<SimilarListings {...props({ productImageIds: ['img-query', 'img-2'] })} />);
    await settle();
    expect(vi.mocked(findSimilar)).toHaveBeenCalledTimes(1);
  });

  it('unmounting mid-fetch does not write state afterwards', async () => {
    let resolve: (v: { status: 'ok'; rows: SimilarListing[] }) => void = () => {};
    vi.mocked(findSimilar).mockReturnValue(
      new Promise((r) => { resolve = r as typeof resolve; }),
    );
    const view = mount(<SimilarListings {...props()} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    view.unmount();
    await act(async () => { resolve({ status: 'ok', rows: [match()] }); await Promise.resolve(); });
    // No throw, no warning, and nothing rendered into a detached container.
    expect(view.container.innerHTML).toBe('');
  });
});
