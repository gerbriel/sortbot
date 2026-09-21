import { useCallback, useEffect, useRef, useState } from 'react';
import { Images, Copy, Loader2, Search } from 'lucide-react';
import {
  embeddingsAvailable,
  ensureEmbeddings,
  fetchEmbeddedPhotoIds,
  findSimilar,
  formatPrice,
  formatSoldLine,
  isNearDuplicate,
  pollEmbedJob,
  type SimilarListing,
} from '../lib/embeddingsService';
import './SimilarListings.css';

/** How many cards the strip shows. Eight is what fits on a desktop row without
 *  becoming a second grid, and it is a strip to glance at, not a page to study. */
const MAX_CARDS = 8;

/** Job polling: every 1.5 s, giving up after a minute. A 400-photo embed job takes
 *  far longer than that, but this button only ever submits ONE listing's photos —
 *  so a minute of silence means something is wrong, not that it is still working. */
const POLL_MS = 1500;
const POLL_LIMIT = 40;

type Phase =
  | { kind: 'loading' }
  /** The feature is off: no service URL, or the migration has not been run. */
  | { kind: 'hidden' }
  | { kind: 'rows'; rows: SimilarListing[] }
  /** Nothing to show, and this photo has never been analysed — offer the button. */
  | { kind: 'not-analysed' }
  /** Analysed, and genuinely nothing like it in this workspace. */
  | { kind: 'none' }
  | { kind: 'working'; message: string }
  | { kind: 'failed'; message: string };

export interface SimilarListingsProps {
  /** `product_images.id` for the photo to compare — NOT an item or product id. */
  productImageId: string;
  /**
   * The workspace. Null means no workspace (the waitlist case), and the strip
   * renders nothing: there is no history to compare against. It is also a
   * dependency of the fetch, so switching workspace re-asks rather than showing
   * the previous shop's comps.
   */
  orgId: string | null;
  /**
   * Every photo of THIS listing, when the caller knows them. "Find similar"
   * embeds all of them, because a listing whose back view is embedded and whose
   * front view is not will match on whichever the seller happens to be looking at.
   * Omitted, only `productImageId` is embedded.
   */
  productImageIds?: readonly string[];
  /** Open one of the matches. Omitted, the cards are not interactive. */
  onOpen?: (productGroupId: string, batchId: string | null) => void;
}

/**
 * SimilarListings — "you have listed something like this before".
 *
 * WHAT IT IS FOR, and it is two things at once (docs/pricing/00-plan.md step 3).
 * The shop's own sold history is the cheapest comp source it will ever have, and
 * it is the only one that improves as the shop sells — so the first job is to put
 * what a near-identical piece went for in front of the seller while they are
 * pricing this one. The second job is duplicate detection: at 0.92 cosine and up
 * the two photos are the same garment, which is the one thing a reseller with
 * 4,000 listings genuinely cannot check from memory. That is why the duplicate
 * chip is the loudest thing in the component.
 *
 * IT RENDERS NOTHING UNTIL IT HAS SOMETHING TRUE TO SAY. No service URL, no
 * migration, no workspace → no element at all, in the house style (labelsService,
 * brandAliasService, backgroundService): the code ships before the SQL is run.
 *
 * ONE FETCH PER MOUNT, keyed on the photo. The second read — "has this photo been
 * analysed at all?" — is made only when there are no neighbours, because that is
 * the only time the answer changes what is on screen (an empty result means either
 * "never analysed" or "nothing like it", and those want opposite words).
 */
export default function SimilarListings({
  productImageId,
  orgId,
  productImageIds,
  onOpen,
}: SimilarListingsProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A stable dependency. The array identity changes on every parent render in
  // Step 3; the SET of ids rarely does, and re-fetching on every keystroke of
  // every field would be a request per character typed.
  const idKey = (productImageIds && productImageIds.length ? [...productImageIds] : [productImageId])
    .filter(Boolean)
    .join(',');

  const load = useCallback(async () => {
    const res = await findSimilar(productImageId, MAX_CARDS * 2);
    if (cancelled.current) return;
    if (res.status === 'unavailable') { setPhase({ kind: 'hidden' }); return; }
    if (res.status === 'error') { setPhase({ kind: 'failed', message: res.error }); return; }
    if (res.rows.length > 0) { setPhase({ kind: 'rows', rows: res.rows.slice(0, MAX_CARDS) }); return; }

    // Nothing to show. Only NOW is it worth asking why.
    const embedded = await fetchEmbeddedPhotoIds([productImageId]);
    if (cancelled.current) return;
    if (embedded.status === 'unavailable') { setPhase({ kind: 'hidden' }); return; }
    setPhase(embedded.ids.has(productImageId) ? { kind: 'none' } : { kind: 'not-analysed' });
  }, [productImageId]);

  useEffect(() => {
    cancelled.current = false;
    setPhase({ kind: 'loading' });
    (async () => {
      if (!productImageId || !orgId) { setPhase({ kind: 'hidden' }); return; }
      const ok = await embeddingsAvailable();
      if (cancelled.current) return;
      if (!ok) { setPhase({ kind: 'hidden' }); return; }
      await load();
    })();
    return () => {
      cancelled.current = true;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    };
  }, [productImageId, orgId, load]);

  /**
   * Embed this listing's photos, then look again.
   *
   * The poll exists because the service answers 202 and does the work afterwards
   * — there is nothing to await. `accepted === 0` means every photo was already
   * embedded under the current model, so there is nothing to wait for and the
   * re-read happens immediately.
   */
  const handleFind = useCallback(async () => {
    setPhase({ kind: 'working', message: 'Analysing this listing…' });
    const submitted = await ensureEmbeddings(idKey ? idKey.split(',') : [productImageId]);
    if (cancelled.current) return;
    if (!submitted.ok) { setPhase({ kind: 'failed', message: submitted.error }); return; }

    const { jobId, accepted } = submitted.value;
    if (!jobId || accepted === 0) { await load(); return; }

    let polls = 0;
    const tick = async () => {
      if (cancelled.current) return;
      const progress = await pollEmbedJob(jobId);
      if (cancelled.current) return;
      // A 404 means the service restarted and lost its progress counter; the rows
      // it had already written are still there, so looking again is the right move
      // rather than reporting a failure (the same reasoning as JOB_GONE_MESSAGE).
      if (!progress.ok) { await load(); return; }
      if (progress.value.status === 'done') { await load(); return; }
      if (++polls >= POLL_LIMIT) {
        setPhase({ kind: 'failed', message: 'That is taking longer than expected — try again.' });
        return;
      }
      setPhase({
        kind: 'working',
        message: `Analysing this listing… ${progress.value.done}/${progress.value.total}`,
      });
      timer.current = setTimeout(tick, POLL_MS);
    };
    timer.current = setTimeout(tick, POLL_MS);
  }, [idKey, productImageId, load]);

  if (phase.kind === 'hidden' || phase.kind === 'loading') return null;

  const rows = phase.kind === 'rows' ? phase.rows : [];
  const duplicates = rows.filter((r) => isNearDuplicate(r.similarity));

  return (
    <section className="sl-root" aria-labelledby="sl-head">
      <div className="sl-head" id="sl-head">
        <Images size={14} aria-hidden="true" />
        <span className="sl-head-text">Similar past listings</span>
        {duplicates.length > 0 && (
          <span className="sl-dup-chip">
            <Copy size={11} aria-hidden="true" />
            {duplicates.length === 1
              ? 'Possible duplicate'
              : `${duplicates.length} possible duplicates`}
          </span>
        )}
      </div>

      {phase.kind === 'failed' && <p className="sl-note sl-note--warn">{phase.message}</p>}

      {phase.kind === 'working' && (
        <p className="sl-note">
          <Loader2 size={13} className="sl-spin" aria-hidden="true" />
          {phase.message}
        </p>
      )}

      {phase.kind === 'none' && (
        <p className="sl-note">Nothing in this workspace looks like this one yet.</p>
      )}

      {(phase.kind === 'not-analysed' || phase.kind === 'failed') && (
        <button type="button" className="sl-find" onClick={handleFind}>
          <Search size={13} aria-hidden="true" />
          <span className="sl-find-label">Find similar</span>
        </button>
      )}

      {rows.length > 0 && (
        <ul className="sl-strip" role="list">
          {rows.map((row) => {
            const sold = formatSoldLine(row);
            const price = formatPrice(row.price);
            const duplicate = isNearDuplicate(row.similarity);
            const openable = Boolean(onOpen && row.productGroupId);
            const body = (
              <>
                <span className="sl-thumb">
                  {row.thumbnailUrl ? (
                    <img src={row.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className="sl-thumb-empty" aria-hidden="true" />
                  )}
                  <span className="sl-badge" data-label={row.label}>
                    {row.label}
                  </span>
                </span>
                <span className="sl-card-title">{row.title}</span>
                <span className="sl-card-meta">
                  {price && <span className="sl-price">{price}</span>}
                  {sold ? (
                    <span className="sl-sold">{sold}</span>
                  ) : (
                    <span className="sl-unsold">not sold yet</span>
                  )}
                </span>
                {duplicate && (
                  // A real element, not a pseudo-element or a title attribute: this
                  // is the claim the seller acts on, so it has to be in the
                  // accessibility tree and it has to survive a copy-paste.
                  <span className="sl-card-dup">Looks like the same garment</span>
                )}
              </>
            );

            return (
              <li key={row.productImageId} className="sl-item">
                {openable ? (
                  <button
                    type="button"
                    className="sl-card sl-card--open"
                    onClick={() => onOpen?.(row.productGroupId as string, row.batchId)}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="sl-card">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
