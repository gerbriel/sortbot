import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Microscope, ChevronDown, ChevronRight, RefreshCw, Check, Eye,
  AlertTriangle, Loader2, CircleDot,
} from 'lucide-react';
import type { ClothingItem } from '../App';
import {
  identifyListing, confidenceLabel, loadBrandFacts, IDENTIFICATION_ENGINE,
  type BrandFacts, type Identification, type Evidence,
} from '../lib/identification';
import {
  computePrice, formatCents, METHOD_LABELS, type PriceComp, type PriceSuggestion,
} from '../lib/pricing';
import {
  researchAvailable, fetchOwnComps, saveIdentification, savePrice, logEvents,
  markIdentificationReviewed, type PricingEventInput,
} from '../lib/researchService';
import type { ModelRow } from '../lib/vocabService';
import SimilarListings from './SimilarListings';
import './ResearchCard.css';

/**
 * ResearchCard — the Step 3 surface for dating a piece and pricing it.
 *
 * WHAT IT SHOWS: era, condition and flaws, rarity and a price — each with the
 * EVIDENCE behind it, because a suggestion a reseller cannot check is a
 * suggestion they will not use twice. Every figure in the price explanation
 * comes from a comp or from the listing; nothing here names a number the pure
 * `computePrice` did not compute (docs/pricing/00-plan.md, and §18).
 *
 * WHAT IT NEVER DOES: apply anything on its own. Every value is behind a button.
 * The plan's own line is *"It never publishes on its own"*, and the same
 * reasoning applies one level down: a price that appeared in the field without
 * being asked for is a price nobody checked.
 *
 * HOW IT WRITES A FIELD: through the `onApplyField` callback, which Step 3
 * points at `handleTableFieldChange` — the SAME path a typed value takes. So an
 * applied price gets the group-wide patch, the transcript line, the debounced
 * save and the `saveStatusStore` report for free, and this component never
 * touches the workflow store (§8's one-writer rule, and the reason
 * `ProductsView` writes the same way).
 *
 * WHAT IT CAPTURES: one `listing_identifications` row and one `listing_prices`
 * row per run, plus `pricing_events` for every field it suggested — and, when
 * the seller navigates away, a `corrected` event per field whose live value now
 * differs from what was suggested. That diff is the whole point of plan step 1:
 * a suggestion nobody wrote down is a suggestion nobody can learn from. All of
 * it fails quiet; nothing here can interrupt a dictation.
 *
 * PRE-MIGRATION IT RENDERS NOTHING (`researchAvailable()` is false), the house
 * rule: the code ships before the SQL.
 */

export interface ResearchCardProps {
  /** The listing's group leader id — `products.product_group`. */
  productGroupId: string;
  batchId?: string | null;
  /** The coalesced item for the group: what Step 3 is showing. */
  item: ClothingItem;
  /** Words about the piece — the dictation plus the generated description. */
  transcript: string;
  /** `brand_keywords` for this brand, if Step 3 has them. */
  brandTerms?: string[];
  /** The matching `vocab_models` row, if Step 3 has one. */
  model?: ModelRow | null;
  /**
   * Write one field the way a typed value is written. Step 3 passes
   * `handleTableFieldChange`, so this inherits the group patch, the transcript
   * line, the debounce and the save report.
   */
  onApplyField: (fieldKey: string, value: string) => void;
  /** The workspace — the similar-listings strip compares within it only. */
  orgId?: string | null;
  /** `product_images.id` of the listing's lead photo (the embeddings key). */
  productImageId?: string | null;
  /** Every photo of the listing, for "Find similar" to embed in one job. */
  productImageIds?: readonly string[];
  /** Open another listing from the strip (Products view's cross-batch path). */
  onOpenListing?: (productGroupId: string, batchId: string | null) => void;
}

/** Which facets we log a suggestion for, and the value we compare on the way out. */
const TRACKED = ['price', 'era', 'condition', 'flaws'] as const;
type TrackedField = typeof TRACKED[number];

/** The listing's current value for a tracked field, as a comparable string. */
function liveValue(item: ClothingItem, field: TrackedField): string {
  switch (field) {
    case 'price': return item.price == null ? '' : String(item.price);
    case 'era': return (item.era ?? '').trim();
    case 'condition': return item.condition ?? '';
    case 'flaws': return (item.flaws ?? '').trim();
  }
}

/** What the run suggested for a tracked field, in the same shape. */
function suggestedValue(
  ident: Identification, price: PriceSuggestion, field: TrackedField,
): string {
  switch (field) {
    case 'price': return price.suggestedCents == null ? '' : (price.suggestedCents / 100).toFixed(2);
    case 'era': return ident.era.value ?? '';
    case 'condition': return ident.condition.value ?? '';
    case 'flaws': return ident.condition.flaws.join(', ');
  }
}

/** One run's snapshot, kept per listing so the diff on the way out is honest. */
interface Snapshot {
  identificationId: string | null;
  suggested: Record<TrackedField, string>;
  /** Fields already logged as corrected/accepted for THIS snapshot. */
  settled: Set<TrackedField>;
}

const EVIDENCE_KIND_WORDS: Readonly<Record<Evidence['kind'], string>> = {
  voice: 'From the notes',
  brand: 'Brand knowledge',
  model: 'Model knowledge',
  tag: 'Tag',
  construction: 'Construction',
  field: 'You set it',
};

function ConfidenceChip({ value }: { value: number }) {
  const band = confidenceLabel(value);
  return (
    <span className={`rc-conf rc-conf--${band.toLowerCase()}`}>
      {band} · {Math.round(value * 100)}%
    </span>
  );
}

function WhyList({ evidence }: { evidence: readonly Evidence[] }) {
  const [open, setOpen] = useState(false);
  if (evidence.length === 0) return null;
  return (
    <div className="rc-why">
      <button
        type="button"
        className="rc-why-toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
        Why {open ? '' : `(${evidence.length})`}
      </button>
      {open && (
        <ul className="rc-why-list">
          {evidence.map((e, i) => (
            <li key={`${e.kind}-${i}`} className={e.agrees === false ? 'rc-why-against' : undefined}>
              <span className="rc-why-kind">{EVIDENCE_KIND_WORDS[e.kind]}</span>
              <span className="rc-why-text">{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Five dots. A rarity meter, because a percentage invites false precision. */
function RarityMeter({ score }: { score: number }) {
  const filled = Math.round(score * 5);
  return (
    <span className="rc-dots" role="img" aria-label={`Rarity ${filled} out of 5`}>
      {[0, 1, 2, 3, 4].map(i => (
        <CircleDot
          key={i}
          size={11}
          aria-hidden="true"
          className={i < filled ? 'rc-dot rc-dot--on' : 'rc-dot'}
        />
      ))}
    </span>
  );
}

export default function ResearchCard({
  productGroupId, batchId, item, transcript, brandTerms, model, onApplyField,
  orgId, productImageId, productImageIds, onOpenListing,
}: ResearchCardProps) {
  const [available, setAvailable] = useState(false);
  const [comps, setComps] = useState<PriceComp[]>([]);
  const [compsLoading, setCompsLoading] = useState(false);
  const [compsUnavailable, setCompsUnavailable] = useState(false);
  /**
   * The per-listing UI state is KEYED by listing rather than reset when the
   * listing changes: resetting it would be setState inside an effect, which
   * react-hooks v7 rejects, and deriving it cannot go stale for a frame the way
   * a correcting effect can (the same reasoning as `shownStep` in §6).
   */
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [reviewError, setReviewError] = useState<{ gid: string; message: string } | null>(null);
  /** `${groupId}:${fieldKey}` → the seller pressed "Use this". */
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    researchAvailable().then(ok => { if (!cancelled) setAvailable(ok); });
    return () => { cancelled = true; };
  }, []);

  /**
   * ONE COMPS FETCH PER LISTING PER SESSION. The plan's own rule is "search once
   * per design rather than per item"; within a session the same listing must not
   * re-read on every keystroke either, so the result is cached in a ref keyed by
   * the listing. "Refresh comps" bumps a counter to force one.
   */
  const compsCache = useRef(new Map<string, PriceComp[]>());
  const [refreshTick, setRefreshTick] = useState(0);

  const brand = (item.brand ?? '').trim();
  const category = (item.productType || item.category || '').trim();
  const era = (item.era ?? '').trim();

  useEffect(() => {
    if (!available || !productGroupId) return;
    const key = `${productGroupId}|${brand}|${category}|${era}|${refreshTick}`;
    const hit = compsCache.current.get(key);
    if (hit) { setComps(hit); setCompsUnavailable(false); return; }
    let cancelled = false;
    setCompsLoading(true);
    fetchOwnComps({ brand, category, era, excludeGroupId: productGroupId })
      .then(res => {
        if (cancelled) return;
        if (res.status !== 'ok') { setCompsUnavailable(true); setComps([]); return; }
        compsCache.current.set(key, res.rows);
        setCompsUnavailable(false);
        setComps(res.rows);
      })
      .finally(() => { if (!cancelled) setCompsLoading(false); });
    return () => { cancelled = true; };
  }, [available, productGroupId, brand, category, era, refreshTick]);

  /**
   * What the knowledge base knows about this brand — injected, not imported.
   *
   * The table is ~113 kB and shares a chunk with `builtinBrandVocab`, which
   * `brandAliasService` already fetches on the first unknown brand, so this adds
   * no chunk and costs at most one fetch per session (§14 #47 and the note in
   * identification.ts). Absent — no brand, still loading, a failed fetch — the
   * pass simply has one fewer signal, which is why it is optional rather than
   * awaited before the card renders.
   */
  const [loadedFacts, setLoadedFacts] = useState<{ key: string; facts: BrandFacts | null } | null>(null);
  const brandKey = brand.toLowerCase();
  useEffect(() => {
    if (!brandKey) return;
    let cancelled = false;
    loadBrandFacts(brandKey).then(f => {
      if (!cancelled) setLoadedFacts({ key: brandKey, facts: f });
    });
    return () => { cancelled = true; };
  }, [brandKey]);
  // DERIVED, so a stale answer for the previous brand can never be read: the
  // state carries the brand it is about, and a mismatch reads as "not loaded".
  const brandFacts = loadedFacts?.key === brandKey ? loadedFacts.facts : null;

  /**
   * The identification, recomputed whenever what it reads changes. Pure and
   * sub-millisecond, so a memo is about referential stability for the effects
   * below rather than about cost.
   */
  const identification = useMemo(
    () => identifyListing({ item, transcript, brandTerms, model, brandFacts }),
    [item, transcript, brandTerms, model, brandFacts],
  );

  /**
   * A price the seller said out loud wins outright — and `item.price` IS that
   * price once dictation has written it, which is why this passes it straight in
   * rather than trying to distinguish "spoken" from "typed". Either way a human
   * decided, and either way the engine must not second-guess it.
   */
  const spokenPriceCents = useMemo(() => {
    const n = typeof item.price === 'number' ? item.price : parseFloat(String(item.price ?? ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  }, [item.price]);

  const price = useMemo(
    () => computePrice({ comps, identification, item, spokenPriceCents }),
    [comps, identification, item, spokenPriceCents],
  );

  // ── Capture ───────────────────────────────────────────────────────────────

  const snapshots = useRef(new Map<string, Snapshot>());

  /**
   * Log a run. Keyed on the SUGGESTION, not on the render: a run is written once
   * per (listing, suggestion set), so re-rendering while the seller types does
   * not append a row per keystroke. The key deliberately excludes anything the
   * seller can change without changing the suggestion.
   */
  const runKey = useMemo(() => JSON.stringify({
    g: productGroupId,
    e: identification.era.value,
    c: identification.condition.value,
    f: identification.condition.flaws,
    r: identification.rarity.score,
    p: price.suggestedCents,
    m: price.method,
  }), [productGroupId, identification, price]);

  const loggedRuns = useRef(new Set<string>());

  useEffect(() => {
    if (!available || !productGroupId || compsLoading) return;
    if (loggedRuns.current.has(runKey)) return;
    loggedRuns.current.add(runKey);

    const suggested = {
      price: suggestedValue(identification, price, 'price'),
      era: suggestedValue(identification, price, 'era'),
      condition: suggestedValue(identification, price, 'condition'),
      flaws: suggestedValue(identification, price, 'flaws'),
    } as Record<TrackedField, string>;

    // Replace the snapshot for this listing. Anything unsettled from a previous
    // run of the SAME listing is deliberately dropped: the seller never saw it
    // as the current suggestion, so a correction against it would be fiction.
    snapshots.current.set(productGroupId, {
      identificationId: null, suggested, settled: new Set(),
    });

    const events: PricingEventInput[] = [
      { batchId, productGroupId, field: 'era', suggested: identification.era.value, confidence: identification.era.confidence },
      { batchId, productGroupId, field: 'condition', suggested: identification.condition.value, confidence: identification.condition.confidence },
      { batchId, productGroupId, field: 'flaws', suggested: identification.condition.flaws, confidence: identification.condition.confidence },
      { batchId, productGroupId, field: 'rarity', suggested: identification.rarity.score, confidence: identification.rarity.confidence },
      { batchId, productGroupId, field: 'price', suggested: { cents: price.suggestedCents, method: price.method }, confidence: price.confidence },
    ];
    if (identification.suggestions.title) {
      events.push({ batchId, productGroupId, field: 'title', suggested: identification.suggestions.title });
    }
    if (identification.suggestions.tags?.length) {
      events.push({ batchId, productGroupId, field: 'tags', suggested: identification.suggestions.tags });
    }

    // All three writes fail quiet — see the module header. The identification's
    // new id IS awaited, but only to make "Mark reviewed" able to address the
    // row; nothing on screen waits for it.
    void saveIdentification({
      batchId, productGroupId,
      era: identification.era.value,
      eraEvidence: identification.era.evidence,
      condition: identification.condition.value,
      flaws: identification.condition.flaws,
      rarity: identification.rarity.score,
      rarityEvidence: identification.rarity.evidence,
      confidence: identification.confidence,
      suggestions: identification.suggestions as Record<string, unknown>,
      source: 'rules',
      model: IDENTIFICATION_ENGINE,
    }).then(res => {
      const snap = snapshots.current.get(productGroupId);
      if (snap && res.id) snap.identificationId = res.id;
    });
    void savePrice({
      batchId, productGroupId,
      suggestedCents: price.suggestedCents,
      lowCents: price.lowCents,
      highCents: price.highCents,
      method: price.method,
      explanation: price.explanation,
      confidence: price.confidence,
      comps: price.compsUsed,
      needsReview: price.needsReview,
      reviewReasons: price.reviewReasons,
    });
    void logEvents(events);
  }, [available, productGroupId, batchId, compsLoading, runKey, identification, price]);

  /**
   * The corrections. A `corrected` / `accepted` event per tracked field whose
   * LIVE value now differs from what was suggested — written when the listing
   * changes or the card unmounts, which is when the seller has finished with it.
   *
   * ONCE PER (listing, field, snapshot): `settled` is what stops a listing that
   * is navigated away from and back again logging the same correction twice.
   *
   * The whole thing reads the LATEST values through a ref rather than the render
   * closure, because the cleanup runs after the last render and the closure's
   * `item` is one render stale by definition — the same rule §14 #14 states for
   * every async handler in this app.
   */
  const latest = useRef({ item, identification, price, batchId, productGroupId, available });
  // Assigned in a LAYOUT effect, not during render: `react-hooks/refs` rejects a
  // render-time ref write, and this is the same construction App's
  // `useEventCallback` uses for exactly this reason (§8).
  useLayoutEffect(() => {
    latest.current = { item, identification, price, batchId, productGroupId, available };
  });

  const flushCorrections = useCallback(() => {
    const { item: it, batchId: bid, productGroupId: gid, available: ok } = latest.current;
    if (!ok || !gid) return;
    const snap = snapshots.current.get(gid);
    if (!snap) return;
    const events: PricingEventInput[] = [];
    for (const field of TRACKED) {
      if (snap.settled.has(field)) continue;
      const was = snap.suggested[field];
      const now = liveValue(it, field);
      if (!was && !now) continue;                 // nothing suggested, nothing set
      snap.settled.add(field);
      events.push({
        batchId: bid, productGroupId: gid, field,
        suggested: was || null,
        corrected: now === was ? null : (now || null),
        accepted: now === was,
        source: 'user',
      });
    }
    if (events.length) void logEvents(events);
  }, []);

  useEffect(() => flushCorrections, [flushCorrections, productGroupId]);

  // ── Apply ─────────────────────────────────────────────────────────────────

  const apply = (fieldKey: string, value: string) => {
    onApplyField(fieldKey, value);
    setAppliedKeys(keys => new Set(keys).add(`${productGroupId}:${fieldKey}`));
    // Record the acceptance now rather than waiting for the diff: the seller
    // pressing "Use this" IS the signal, and the diff would only see that the
    // value happens to match.
    const snap = snapshots.current.get(productGroupId);
    const field = TRACKED.find(f => f === fieldKey) as TrackedField | undefined;
    if (snap && field) snap.settled.add(field);
    void logEvents([{
      batchId, productGroupId,
      field: (field ?? 'title') as PricingEventInput['field'],
      suggested: value, accepted: true, source: 'user',
    }]);
  };

  const onMarkReviewed = async () => {
    const gid = productGroupId;
    setReviewedIds(ids => new Set(ids).add(gid));
    setReviewError(null);
    const snap = snapshots.current.get(productGroupId);
    if (!snap?.identificationId) {
      // The run's insert has not landed (or failed). There is no row to address,
      // so the verdict goes to `pricing_events` instead — the same table the
      // corrections go to, and the one a future queue would read anyway. Better
      // a recorded verdict in the wrong shape than a button that lies.
      void logEvents([{
        batchId, productGroupId, field: 'export',
        suggested: { reviewed: true }, accepted: true, source: 'user',
      }]);
      return;
    }
    // 0 rows updated is a failure here, so the button un-presses itself and says
    // why — a person is waiting on this one (§18 #41).
    const res = await markIdentificationReviewed(snap.identificationId);
    if (!res.ok) {
      setReviewedIds(ids => { const next = new Set(ids); next.delete(gid); return next; });
      setReviewError({ gid, message: res.error });
    }
  };

  if (!available) return null;

  const { era: eraFacet, condition, rarity } = identification;
  const flagged = price.needsReview;
  const reviewed = reviewedIds.has(productGroupId);
  const isApplied = (fieldKey: string) => appliedKeys.has(`${productGroupId}:${fieldKey}`);

  return (
    <section className="rc" aria-label="Research">
      <header className="rc-head">
        <Microscope size={13} aria-hidden="true" />
        <h4 className="rc-title">Research</h4>
        <ConfidenceChip value={identification.confidence} />
        {flagged && !reviewed && (
          <span className="rc-flag">
            <AlertTriangle size={11} aria-hidden="true" /> Needs a look
          </span>
        )}
        <button
          type="button"
          className="rc-refresh"
          onClick={() => setRefreshTick(t => t + 1)}
          disabled={compsLoading}
          title="Re-read this workspace's sold history"
        >
          {compsLoading
            ? <Loader2 size={12} className="rc-spin" aria-hidden="true" />
            : <RefreshCw size={12} aria-hidden="true" />}
          Refresh comps
        </button>
      </header>

      <div className="rc-grid">
        {/* ── Era ─────────────────────────────────────────────────────────── */}
        <div className="rc-facet">
          <div className="rc-facet-head">
            <span className="rc-label">Era</span>
            <span className="rc-value">{eraFacet.value ?? 'Not dated'}</span>
            {eraFacet.value && <ConfidenceChip value={eraFacet.confidence} />}
          </div>
          {eraFacet.value && eraFacet.value !== (item.era ?? '') && (
            <button type="button" className="rc-use" onClick={() => apply('era', eraFacet.value!)}>
              {isApplied('era') ? <Check size={12} aria-hidden="true" /> : null} Use era
            </button>
          )}
          <WhyList evidence={eraFacet.evidence} />
        </div>

        {/* ── Condition + flaws ───────────────────────────────────────────── */}
        <div className="rc-facet">
          <div className="rc-facet-head">
            <span className="rc-label">Condition</span>
            <span className="rc-value">{condition.value ?? 'Not graded'}</span>
            {condition.value && <ConfidenceChip value={condition.confidence} />}
          </div>
          {condition.flaws.length > 0 && (
            <ul className="rc-flaws">
              {condition.flaws.map(f => <li key={f}>{f}</li>)}
            </ul>
          )}
          <div className="rc-actions">
            {condition.value && condition.value !== item.condition && (
              <button type="button" className="rc-use" onClick={() => apply('condition', condition.value!)}>
                {isApplied('condition') ? <Check size={12} aria-hidden="true" /> : null} Use condition
              </button>
            )}
            {condition.flaws.length > 0 && condition.flaws.join(', ') !== (item.flaws ?? '') && (
              <button type="button" className="rc-use" onClick={() => apply('flaws', condition.flaws.join(', '))}>
                {isApplied('flaws') ? <Check size={12} aria-hidden="true" /> : null} Use flaws
              </button>
            )}
          </div>
          <WhyList evidence={condition.evidence} />
        </div>

        {/* ── Rarity ──────────────────────────────────────────────────────── */}
        <div className="rc-facet">
          <div className="rc-facet-head">
            <span className="rc-label">Rarity</span>
            {/* Five empty dots would read as a measured zero. With no signal at
                all the honest rendering is words, not a meter at its floor. */}
            {rarity.evidence.length > 0 ? (
              <>
                <RarityMeter score={rarity.score} />
                <ConfidenceChip value={rarity.confidence} />
              </>
            ) : (
              <span className="rc-unknown">Nothing to go on yet</span>
            )}
          </div>
          <WhyList evidence={rarity.evidence} />
        </div>

        {/* ── Price ───────────────────────────────────────────────────────── */}
        <div className="rc-facet rc-facet--price">
          <div className="rc-facet-head">
            <span className="rc-label">Price</span>
            <span className="rc-value rc-value--price">
              {price.suggestedCents == null ? 'No suggestion' : formatCents(price.suggestedCents)}
            </span>
            {price.suggestedCents != null && <ConfidenceChip value={price.confidence} />}
          </div>
          {price.suggestedCents != null && price.lowCents != null && price.highCents != null && (
            <p className="rc-range">
              {formatCents(price.lowCents)} – {formatCents(price.highCents)} ·{' '}
              <span className="rc-method">{METHOD_LABELS[price.method]}</span>
            </p>
          )}
          {price.suggestedCents != null && (
            <button
              type="button"
              className="rc-use rc-use--primary"
              onClick={() => apply('price', (price.suggestedCents! / 100).toFixed(2))}
            >
              {isApplied('price') ? <Check size={12} aria-hidden="true" /> : null} Use this price
            </button>
          )}
          <ul className="rc-explain">
            {price.explanation.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
          {compsUnavailable ? (
            <p className="rc-note">Could not read this workspace's sold history just now.</p>
          ) : (
            <p className="rc-note">
              {comps.length === 0
                ? 'No sold history for this kind of piece yet — mark pieces sold in Products and the next one has comparables.'
                : `Read ${comps.length} of your own recorded sale${comps.length === 1 ? '' : 's'}.`}
            </p>
          )}
        </div>
      </div>

      {flagged && (
        <div className="rc-review">
          <p className="rc-review-head">
            <AlertTriangle size={12} aria-hidden="true" /> Worth a look before this one goes out:
          </p>
          <ul className="rc-review-list">
            {price.reviewReasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          <button
            type="button"
            className="rc-use"
            onClick={() => void onMarkReviewed()}
            disabled={reviewed}
          >
            {reviewed ? <Check size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
            {reviewed ? 'Reviewed' : 'Mark reviewed'}
          </button>
          {reviewError?.gid === productGroupId && (
            <p className="rc-error" role="alert">{reviewError.message}</p>
          )}
        </div>
      )}

      {/* The embeddings strip (step 3 of the plan). It renders nothing until
          listing_embeddings.sql has run and VITE_MATTING_URL is set, and it needs
          the lead photo's product_images id, which a listing only has once its
          rows have been hydrated — hence the guard. */}
      <div className="rc-similar-slot">
        {productImageId ? (
          <SimilarListings
            productImageId={productImageId}
            orgId={orgId ?? null}
            productImageIds={productImageIds}
            onOpen={onOpenListing}
          />
        ) : null}
      </div>
    </section>
  );
}
