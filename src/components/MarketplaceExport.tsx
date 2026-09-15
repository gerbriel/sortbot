import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ClipboardCopy, Copy, Download, Images, Package,
  RefreshCw, Store, Tag,
} from 'lucide-react';
import type JSZipStatic from 'jszip';   // type only — the value is dynamically imported
import type { ClothingItem } from '../App';
import type { DescriptionSettings } from '../lib/descriptionSettings';
import { publicImageUrl } from '../lib/storageUrls';
import { buildGroupArray } from '../lib/grouping';
import { buildCleanTitle } from '../lib/csvExport';
import { log } from '../lib/debugLogger';
import { selectablePlatforms, type PlatformPricingRule } from '../lib/platformPricing';
import { coalesceGroup } from '../lib/marketplaces/shared';
import { getAdapter } from '../lib/marketplaces/registry';
import { buildListingPack, packToText, type ListingPack } from '../lib/marketplaces/pack';
import {
  cellSummary, effectiveTargets, fixableIssues, nextTargets, summarizeMatrix,
  type IssueSummary, type MarketplaceSummary,
} from '../lib/marketplaces/matrix';
import {
  MARKETPLACE_KEYS,
  type FormattedListing, type MarketplaceKey, type VocabResolver,
} from '../lib/marketplaces/types';
import {
  buildVocabResolver, fetchBatchTargets, fetchOrgMarketplaces, fetchPublications,
  fetchVocab, marketplaceName, setBatchTargets, upsertPublication, upsertVocab,
  type OrgMarketplaceRow, type PublicationRow, type PublicationStatus, type VocabRow,
} from '../lib/marketplaceService';
import { Badge, Button, EmptyState, ToggleChip } from './ui';
import './MarketplaceExport.css';

/**
 * Step 4 — MARKETPLACES.
 *
 * Everything the adapters (src/lib/marketplaces/*) and the service
 * (src/lib/marketplaceService.ts) built, made usable: which marketplaces THIS
 * batch goes to, a readiness grid of listings × marketplaces, a feed CSV per
 * feed marketplace, a copy-ready pack per pack marketplace, an inline fix for a
 * vocabulary gap, and a record of what has been posted. No API key, no
 * connector — plan phases 1 and 2 (docs/marketplaces/00-plan.md §5).
 *
 * WHAT THIS PANEL DOES NOT OWN: the Shopify CSV. `GoogleSheetExporter` sits
 * directly below it and keeps that file — it dedups titles against the live
 * store, fetches per-store metaobject GIDs and runs the price gate, none of
 * which `shopify.serialize` can do (01-adapters.md §4.1). Shopify appears here
 * as a READINESS column only, and its header says where the download is. Two
 * buttons producing two different Shopify CSVs is the mistake this avoids.
 *
 * PRE-MIGRATION (`marketplaces.sql` not run) the whole panel is one setup line
 * and Step 4 behaves exactly as it did before — the standing forward-compatible
 * rule (labelsService, brandAliasService, financeService).
 */

export interface MarketplaceExportProps {
  orgId: string | null;
  batchId: string | null;
  /** The batch's export list — App's memoized `step4ExportItems`. */
  items: ClothingItem[];
  /** The SHOP's name (the Shopify Vendor column), never a garment brand. */
  vendorName?: string;
  descriptionSettings?: DescriptionSettings | null;
  isOrgAdmin: boolean;
  onToast: (msg: string) => void;
  /** Opens the Workspace dashboard on its Marketplaces tab. */
  onOpenWorkspaceMarketplaces: () => void;
}

/** One row of the grid: the photo group, its coalesced fields and its photos. */
interface ListingRow {
  productGroupId: string;
  title: string;
  sku: string | null;
  group: ClothingItem[];
  item: ClothingItem;
  imageUrls: string[];
}

/**
 * The same rule `GoogleSheetExporter.resolvePublicUrl` follows: `imageUrls[0]`
 * when it is a real https URL, else rebuilt from `storagePath` THROUGH
 * `storageUrls` (§18 #20), else a `preview` only if it is not a blob: URL — a
 * blob is session-local and useless in a feed, a pack or a zip.
 */
function resolveUrl(item: ClothingItem): string {
  const candidate = item.imageUrls?.[0] || '';
  if (candidate.startsWith('https://')) return candidate;
  if (item.storagePath) return publicImageUrl(item.storagePath);
  const preview = item.preview || '';
  return preview.startsWith('https://') ? preview : '';
}

const STATUS_TONE: Readonly<Record<PublicationStatus, 'neutral' | 'info' | 'success' | 'warning'>> = {
  draft: 'neutral',
  exported: 'info',
  posted: 'info',
  live: 'success',
  sold: 'success',
  removed: 'warning',
};

/** Fires the browser download for one serialized feed. Object URL revoked on a
 *  deferred tick — Safari can still be reading the href when click() returns
 *  (the same reason `GoogleSheetExporter` defers its revoke). */
function downloadFile(filename: string, mime: string, body: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Clipboard, with the fallback that matters.
 *
 * `navigator.clipboard` is absent outside a secure context and can be refused
 * by permission — and a pack is a row of copy buttons, so a silent no-op there
 * is the whole feature failing quietly. The fallback selects a hidden textarea
 * and runs `execCommand('copy')`, which still works in every engine this app
 * supports. The caller says which path ran, because "copied" and "copied the
 * old-fashioned way" are different amounts of trust.
 */
async function copyText(text: string): Promise<'clipboard' | 'fallback' | 'failed'> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'clipboard';
    }
  } catch {
    // fall through — a rejection here is a permission, not a bug
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok ? 'fallback' : 'failed';
  } catch {
    return 'failed';
  }
}

/** `01.jpg` — a zip a seller uploads in order, so the names must sort. */
const photoName = (index: number, url: string): string => {
  const ext = (url.split('?')[0].split('.').pop() ?? '').toLowerCase();
  const safe = /^(jpe?g|png|webp|gif)$/.test(ext) ? ext : 'jpg';
  return `${String(index + 1).padStart(2, '0')}.${safe}`;
};

/* jszip's .d.ts uses `export = JSZip`, so the module namespace is not a plain
   record — resolve `default` inside the loader and cache the class itself, the
   same shape `ImageUpload` uses. Lazy because jszip is ~97 kB and nothing in
   Step 4 needs it unless a pack's photos are actually downloaded. */
let jszipPromise: Promise<JSZipStatic> | null = null;
const loadJSZip = () => (jszipPromise ??= import('jszip').then(m => m.default));

function MarketplaceExportInner({
  orgId, batchId, items, vendorName, descriptionSettings,
  isOrgAdmin, onToast, onOpenWorkspaceMarketplaces,
}: MarketplaceExportProps) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [orgRows, setOrgRows] = useState<OrgMarketplaceRow[]>([]);
  const [vocabRows, setVocabRows] = useState<VocabRow[]>([]);
  const [storedTargets, setStoredTargets] = useState<MarketplaceKey[]>([]);
  const [publications, setPublications] = useState<PublicationRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [openPacks, setOpenPacks] = useState<MarketplaceKey | null>(null);
  const [fixDraft, setFixDraft] = useState<Record<string, string>>({});
  const loadSeq = useRef(0);

  // ── Load ──────────────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    if (!orgId) { setAvailable(false); return; }
    const seq = ++loadSeq.current;
    const [mk, vc, tg, pb] = await Promise.all([
      fetchOrgMarketplaces(orgId),
      fetchVocab(orgId),
      batchId ? fetchBatchTargets(batchId) : Promise.resolve({ status: 'ok' as const, targets: [] }),
      batchId ? fetchPublications(orgId, batchId) : Promise.resolve({ status: 'ok' as const, rows: [] }),
    ]);
    if (seq !== loadSeq.current) return;   // a later load won
    if (mk.status !== 'ok') { setAvailable(false); return; }
    setAvailable(true);
    setOrgRows(mk.rows);
    setVocabRows(vc.status === 'ok' ? vc.rows : []);
    setStoredTargets(tg.status === 'ok' ? tg.targets : []);
    setPublications(pb.status === 'ok' ? pb.rows : []);
  }, [orgId, batchId]);

  useEffect(() => { void reload(); }, [reload]);

  // ── Derived, all memoized ─────────────────────────────────────────────────
  // MARKETPLACE_KEYS order, not row order: the chips and the matrix columns are
  // the same set, and two different orderings of it read as two different lists.
  const enabled = useMemo(
    () => MARKETPLACE_KEYS.filter(k => orgRows.some(r => r.marketplace === k && r.enabled)),
    [orgRows],
  );
  const targets = useMemo(
    () => effectiveTargets(storedTargets, enabled),
    [storedTargets, enabled],
  );

  const vocab: VocabResolver = useMemo(() => buildVocabResolver(vocabRows), [vocabRows]);

  /** The workspace's price rules, by id. A `pricingRuleId` that no longer
   *  resolves falls back to no adjustment — the same derive-don't-store rule
   *  Step 4's platform selector already follows (§10, feature 21). */
  const rulesById = useMemo(() => {
    const map = new Map<string, PlatformPricingRule>();
    for (const r of selectablePlatforms(descriptionSettings?.platformPricing)) map.set(r.id, r);
    return map;
  }, [descriptionSettings]);

  const pricingFor = useCallback((key: MarketplaceKey): PlatformPricingRule | null => {
    const id = orgRows.find(r => r.marketplace === key)?.settings.pricingRuleId;
    return id ? rulesById.get(id) ?? null : null;
  }, [orgRows, rulesById]);

  /** One row per listing — the same groups Step 3 navigates and the same
   *  coalescing the Shopify export uses, so a row here IS a listing there. */
  const rows: ListingRow[] = useMemo(() => {
    return buildGroupArray(items).map((group, idx) => {
      const item = coalesceGroup(group);
      return {
        productGroupId: item.productGroup || item.id || `row-${idx}`,
        title: buildCleanTitle(item, idx),
        sku: (item.sku ?? '').trim() || null,
        group,
        item,
        imageUrls: group.map(resolveUrl).filter(Boolean),
      };
    });
  }, [items]);

  /**
   * `format()` for every (listing × target). Pure and a few hundred calls at
   * batch scale, so it is memoized on everything that can change its answer —
   * recomputing it per render would re-run ten adapters over 375 listings on
   * every keystroke in the fix inputs.
   */
  const formatted = useMemo(() => {
    const out = new Map<MarketplaceKey, FormattedListing[]>();
    for (const key of targets) {
      const adapter = getAdapter(key);
      const pricingRule = pricingFor(key);
      out.set(key, rows.map(r => adapter.format({
        group: r.group,
        item: r.item,
        imageUrls: r.imageUrls,
        vendorName,
        descriptionSettings: descriptionSettings ?? undefined,
        pricingRule,
        vocab,
      })));
    }
    return out;
  }, [targets, rows, vocab, vendorName, descriptionSettings, pricingFor]);

  const summaries: MarketplaceSummary[] = useMemo(
    () => summarizeMatrix(targets, formatted),
    [targets, formatted],
  );

  /** listingId → marketplace → publication row. */
  const pubCells = useMemo(() => {
    const map = new Map<string, Map<MarketplaceKey, PublicationRow>>();
    for (const row of publications) {
      let cells = map.get(row.product_group_id);
      if (!cells) { cells = new Map(); map.set(row.product_group_id, cells); }
      cells.set(row.marketplace, row);
    }
    return map;
  }, [publications]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const toggleTarget = async (key: MarketplaceKey) => {
    const next = nextTargets(targets, key, enabled);
    if (!next) {
      onToast('Keep at least one marketplace selected for this batch.');
      return;
    }
    if (!batchId) { setStoredTargets(next); return; }
    const previous = storedTargets;
    setStoredTargets(next);                        // optimistic
    const res = await setBatchTargets(batchId, next);
    if (!res.ok) {
      setStoredTargets(previous);                  // reconcile — never lie about what is stored
      onToast(res.error);
    }
  };

  /** Records what an export or a paste actually did, one call per listing.
   *  Serial rather than parallel: these are writes against one table keyed on
   *  one triple, and a burst of 375 concurrent PATCHes is how a workspace gets
   *  rate-limited mid-download. */
  const recordPublications = async (
    key: MarketplaceKey,
    listings: readonly FormattedListing[],
    status: PublicationStatus,
    stamp?: { postedAt?: string },
  ): Promise<number> => {
    let failed = 0;
    for (const l of listings) {
      if (!l.productGroupId) continue;
      const res = await upsertPublication({
        batchId: batchId ?? null,
        productGroupId: l.productGroupId,
        sku: l.sku,
        marketplace: key,
        status,
        priceCents: l.price !== null ? Math.round(l.price * 100) : null,
        ...(stamp?.postedAt ? { postedAt: stamp.postedAt } : {}),
      });
      if (!res.ok) failed++;
    }
    if (batchId && orgId) {
      const pb = await fetchPublications(orgId, batchId);
      if (pb.status === 'ok') setPublications(pb.rows);
    }
    return failed;
  };

  const downloadFeed = async (key: MarketplaceKey) => {
    const adapter = getAdapter(key);
    const listings = formatted.get(key) ?? [];
    const summary = summaries.find(s => s.marketplace === key);
    if (!adapter.serialize || listings.length === 0) return;
    if (summary?.blocked) {
      onToast(`Cannot export — ${summary.error} listing${summary.error === 1 ? '' : 's'} still ${summary.error === 1 ? 'has' : 'have'} an error for ${adapter.spec.name}.`);
      return;
    }
    setBusy(`feed:${key}`);
    try {
      const feed = adapter.serialize(listings);
      downloadFile(feed.filename, feed.mime, feed.body);
      const failed = await recordPublications(key, listings, 'exported');
      onToast(failed === 0
        ? `${feed.filename} — ${feed.count} listing${feed.count === 1 ? '' : 's'}.`
        : `${feed.filename} downloaded, but ${failed} record${failed === 1 ? '' : 's'} could not be saved.`);
    } catch (err) {
      log.error(`marketplace feed | ${key} | ${String(err)}`);
      onToast(`Could not build the ${adapter.spec.name} file.`);
    } finally {
      setBusy(null);
    }
  };

  const markPosted = async (key: MarketplaceKey, listing: FormattedListing, status: PublicationStatus) => {
    setBusy(`pub:${key}:${listing.productGroupId}`);
    const failed = await recordPublications(key, [listing], status,
      status === 'posted' ? { postedAt: new Date().toISOString() } : undefined);
    setBusy(null);
    onToast(failed === 0
      ? `Marked ${status} on ${marketplaceName(key)}.`
      : `Could not record that on ${marketplaceName(key)}.`);
  };

  const copyField = async (label: string, value: string) => {
    const how = await copyText(value);
    if (how === 'failed') onToast(`Could not copy ${label} — select it and copy by hand.`);
    else if (how === 'fallback') onToast(`${label} copied (this browser blocks the clipboard API, so the old copy path was used).`);
    else onToast(`${label} copied.`);
  };

  const downloadPhotos = async (key: MarketplaceKey, row: ListingRow, pack: ListingPack) => {
    if (pack.photos.length === 0) return;
    setBusy(`zip:${key}:${row.productGroupId}`);
    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      let skipped = 0;
      for (let i = 0; i < pack.photos.length; i++) {
        try {
          const res = await fetch(pack.photos[i]);
          if (!res.ok) { skipped++; continue; }
          zip.file(photoName(i, pack.photos[i]), await res.blob());
        } catch {
          skipped++;
        }
      }
      if (skipped === pack.photos.length) {
        onToast('None of the photos could be fetched — check the connection and try again.');
        return;
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const stem = (row.sku || row.productGroupId).replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `${key}-${stem}.zip`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      onToast(skipped === 0
        ? `${pack.photos.length} photo${pack.photos.length === 1 ? '' : 's'} zipped.`
        : `Zipped ${pack.photos.length - skipped} of ${pack.photos.length} — ${skipped} could not be fetched.`);
    } catch (err) {
      log.error(`marketplace zip | ${key} | ${String(err)}`);
      onToast('Could not build the photo zip.');
    } finally {
      setBusy(null);
    }
  };

  const saveFix = async (key: MarketplaceKey, issue: IssueSummary) => {
    const draftKey = `${key}:${issue.id}`;
    const value = (fixDraft[draftKey] ?? '').trim();
    if (!value || !issue.value || !issue.fixKind) return;
    setBusy(`fix:${draftKey}`);
    const res = await upsertVocab({
      orgId: orgId ?? null,                    // a WORKSPACE row — any member may write one
      marketplace: key,
      kind: issue.fixKind,
      canonical: issue.value,
      marketplaceValue: value,
    });
    if (res.ok && orgId) {
      const vc = await fetchVocab(orgId);
      if (vc.status === 'ok') setVocabRows(vc.rows);   // the matrix re-resolves off this
      setFixDraft(d => { const next = { ...d }; delete next[draftKey]; return next; });
      onToast(`${marketplaceName(key)} will now call "${issue.value}" → "${value}".`);
    } else if (!res.ok) {
      onToast(res.error);
    }
    setBusy(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (available === null) return null;          // first load — nothing to flash

  if (available === false) {
    return (
      <section className="mkx mkx--setup">
        <p className="mkx-setup">
          <Store size={13} /> Multi-marketplace publishing is ready in the app but its
          database tables have not been created yet — run{' '}
          <code>supabase/migrations/marketplaces.sql</code> to turn it on.
        </p>
      </section>
    );
  }

  if (enabled.length === 0) {
    return (
      <section className="mkx">
        <EmptyState
          inline
          icon={<Store size={22} />}
          title="No marketplaces chosen yet"
          description="Pick the marketplaces this shop sells on and they appear here for every batch — with a readiness check, a feed file or a copy-ready listing pack for each."
          actions={
            <Button variant="primary" icon={<Store size={13} />} onClick={onOpenWorkspaceMarketplaces}>
              {isOrgAdmin ? 'Choose marketplaces' : 'Open the workspace dashboard'}
            </Button>
          }
        />
      </section>
    );
  }

  const packSummary = openPacks ? summaries.find(s => s.marketplace === openPacks) : null;

  return (
    <section className="mkx" aria-labelledby="mkx-heading">
      <div className="mkx-head">
        <h3 id="mkx-heading"><Store size={15} /> Marketplaces</h3>
        <Button
          size="sm" variant="ghost" icon={<RefreshCw size={12} />}
          onClick={() => { void reload(); }}
        >
          Refresh
        </Button>
      </div>

      {/* ── Which marketplaces this batch goes to ─────────────────────────── */}
      <div className="mkx-targets" role="group" aria-label="Marketplaces this batch goes to">
        <span className="mkx-targets-label">This batch goes to</span>
        {enabled.map(key => (
          <ToggleChip
            key={key}
            pressed={targets.includes(key)}
            onPressedChange={() => { void toggleTarget(key); }}
          >
            {marketplaceName(key)}
          </ToggleChip>
        ))}
        <button type="button" className="mkx-link" onClick={onOpenWorkspaceMarketplaces}>
          Manage marketplaces
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          inline
          icon={<Package size={22} />}
          title="No listings in this batch yet"
          description="Group and categorise photos in Step 2, then write them up in Step 3 — they appear here as rows."
        />
      ) : (
        <>
          {/* ── Readiness per marketplace ───────────────────────────────────── */}
          <div className="mkx-checks">
            {summaries.map(summary => {
              const adapter = getAdapter(summary.marketplace);
              const fixes = fixableIssues(summary);
              return (
                <article className="mkx-check" key={summary.marketplace}>
                  <header className="mkx-check-head">
                    <h4>{adapter.spec.name}</h4>
                    <span className="mkx-counts">
                      <span className="mkx-count mkx-count--clean">{summary.clean} ready</span>
                      {summary.warning > 0 && (
                        <span className="mkx-count mkx-count--warn">{summary.warning} with warnings</span>
                      )}
                      {summary.error > 0 && (
                        <span className="mkx-count mkx-count--err">{summary.error} blocked</span>
                      )}
                    </span>
                  </header>

                  {!adapter.spec.verified && (
                    <p className="mkx-provisional">
                      Limits for {adapter.spec.name} are provisional — confirm them against{' '}
                      {adapter.spec.docsUrl
                        ? <a href={adapter.spec.docsUrl} target="_blank" rel="noopener noreferrer">its seller documentation</a>
                        : 'its seller documentation'}.
                    </p>
                  )}

                  {summary.issues.length === 0 ? (
                    <p className="mkx-allclear"><Check size={12} /> Every listing is ready.</p>
                  ) : (
                    <ul className="mkx-issues">
                      {summary.issues.map(issue => (
                        <li key={issue.id} className={`mkx-issue mkx-issue--${issue.level}`}>
                          <span className="mkx-issue-count">{issue.count}</span>
                          <span className="mkx-issue-text">{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {fixes.length > 0 && (
                    <div className="mkx-fixes">
                      {fixes.map((issue, fixIdx) => {
                        const draftKey = `${summary.marketplace}:${issue.id}`;
                        // The issue id carries the unresolved value, which is user
                        // text — index by position instead so the DOM id is always
                        // a valid one.
                        const inputId = `mkx-fix-${summary.marketplace}-${fixIdx}`;
                        return (
                          <div className="mkx-fix" key={issue.id}>
                            <label className="mkx-fix-label" htmlFor={inputId}>
                              <Tag size={11} /> Remember: <strong>{issue.value}</strong> →
                            </label>
                            <input
                              id={inputId}
                              className="mkx-fix-input"
                              type="text"
                              value={fixDraft[draftKey] ?? ''}
                              placeholder={`What ${adapter.spec.name} calls it`}
                              onChange={e => setFixDraft(d => ({ ...d, [draftKey]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveFix(summary.marketplace, issue); } }}
                            />
                            <Button
                              size="sm"
                              disabled={!(fixDraft[draftKey] ?? '').trim() || busy === `fix:${draftKey}`}
                              onClick={() => { void saveFix(summary.marketplace, issue); }}
                            >
                              Save
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {/* ── The matrix ──────────────────────────────────────────────────── */}
          <div className="mkx-matrix-wrap">
            <table className="mkx-matrix">
              <thead>
                <tr>
                  <th scope="col" className="mkx-listing-head">
                    Listing <span className="mkx-dim">({rows.length})</span>
                  </th>
                  {summaries.map(summary => {
                    const adapter = getAdapter(summary.marketplace);
                    const isFeed = adapter.spec.channels.includes('feed');
                    const isPack = adapter.spec.channels.includes('pack');
                    const listings = formatted.get(summary.marketplace) ?? [];
                    return (
                      <th scope="col" key={summary.marketplace} className="mkx-mk-head">
                        <span className="mkx-mk-name">{adapter.spec.name}</span>
                        {/* Shopify's CSV stays with GoogleSheetExporter below —
                            it dedups titles against the live store and runs the
                            price gate, which serialize() cannot. */}
                        {summary.marketplace === 'shopify' ? (
                          <span className="mkx-mk-note">Download below</span>
                        ) : isFeed ? (
                          <Button
                            size="sm"
                            icon={<Download size={12} />}
                            disabled={summary.blocked || busy === `feed:${summary.marketplace}`}
                            title={summary.blocked
                              ? `${summary.error} listing(s) still have an error for ${adapter.spec.name}.`
                              : undefined}
                            onClick={() => { void downloadFeed(summary.marketplace); }}
                          >
                            {adapter.spec.name} CSV
                          </Button>
                        ) : null}
                        {isPack && listings.length > 0 && (
                          <Button
                            size="sm"
                            variant={openPacks === summary.marketplace ? 'primary' : 'secondary'}
                            icon={<ClipboardCopy size={12} />}
                            aria-expanded={openPacks === summary.marketplace}
                            onClick={() => setOpenPacks(cur => cur === summary.marketplace ? null : summary.marketplace)}
                          >
                            {openPacks === summary.marketplace ? 'Hide packs' : 'Open packs'}
                          </Button>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={row.productGroupId || idx}>
                    <th scope="row" className="mkx-listing-cell">
                      <span className="mkx-listing-title" title={row.title}>{row.title}</span>
                      <span className="mkx-listing-sku">{row.sku ?? 'no SKU'}</span>
                    </th>
                    {summaries.map(summary => {
                      const listing = (formatted.get(summary.marketplace) ?? [])[idx];
                      const cell = cellSummary(listing);
                      const pubRow = pubCells.get(row.productGroupId)?.get(summary.marketplace);
                      const label = cell.level === 'clean'
                        ? 'Ready'
                        : `${cell.errors} error${cell.errors === 1 ? '' : 's'}, ${cell.warnings} warning${cell.warnings === 1 ? '' : 's'}`;
                      return (
                        <td key={summary.marketplace} className={`mkx-cell mkx-cell--${cell.level}`}>
                          <span className="mkx-cell-mark" title={label} aria-label={label}>
                            {cell.level === 'clean'
                              ? <Check size={13} aria-hidden="true" />
                              : (
                                <>
                                  <AlertTriangle size={11} aria-hidden="true" />
                                  {cell.errors > 0 ? cell.errors : cell.warnings}
                                </>
                              )}
                          </span>
                          {pubRow && (
                            <Badge size="sm" tone={STATUS_TONE[pubRow.status]}>{pubRow.status}</Badge>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Packs for one marketplace ───────────────────────────────────── */}
          {openPacks && packSummary && (
            <div className="mkx-packs">
              <h4 className="mkx-packs-head">
                <ClipboardCopy size={14} /> {getAdapter(openPacks).spec.name} listing packs
                <span className="mkx-dim"> — paste each field into {getAdapter(openPacks).spec.name}, then mark it posted</span>
              </h4>
              {rows.map((row, idx) => {
                const listing = (formatted.get(openPacks) ?? [])[idx];
                if (!listing) return null;
                const pack = buildListingPack(listing);
                const pubRow = pubCells.get(row.productGroupId)?.get(openPacks);
                const zipBusy = busy === `zip:${openPacks}:${row.productGroupId}`;
                return (
                  <article className="mkx-pack" key={row.productGroupId || idx}>
                    <header className="mkx-pack-head">
                      <span className="mkx-pack-title">{row.title}</span>
                      <span className="mkx-pack-actions">
                        <Button
                          size="sm" icon={<Copy size={12} />}
                          onClick={() => { void copyField('Whole pack', packToText(pack)); }}
                        >
                          Copy all
                        </Button>
                        {pubRow && pubRow.status === 'posted' ? (
                          <Button
                            size="sm" variant="secondary"
                            disabled={busy === `pub:${openPacks}:${row.productGroupId}`}
                            onClick={() => { void markPosted(openPacks, listing, 'sold'); }}
                          >
                            Mark sold
                          </Button>
                        ) : (
                          <Button
                            size="sm" variant="primary" icon={<Check size={12} />}
                            disabled={busy === `pub:${openPacks}:${row.productGroupId}`}
                            onClick={() => { void markPosted(openPacks, listing, 'posted'); }}
                          >
                            Mark posted
                          </Button>
                        )}
                        {pubRow && <Badge size="sm" tone={STATUS_TONE[pubRow.status]}>{pubRow.status}</Badge>}
                      </span>
                    </header>

                    <dl className="mkx-pack-fields">
                      {pack.fields.map(f => (
                        <div className="mkx-pack-field" key={f.label}>
                          <dt>
                            {f.label}
                            <button
                              type="button"
                              className="mkx-copy"
                              onClick={() => { void copyField(f.label, f.value); }}
                            >
                              <Copy size={11} /> Copy
                            </button>
                          </dt>
                          <dd>{f.value}</dd>
                        </div>
                      ))}
                    </dl>

                    {pack.photos.length > 0 && (
                      <div className="mkx-pack-photos">
                        <div className="mkx-thumbs">
                          {pack.photos.map((url, i) => (
                            <img
                              key={url}
                              src={url}
                              alt={`${row.title} — photo ${i + 1}`}
                              loading="lazy"
                              decoding="async"
                            />
                          ))}
                        </div>
                        <Button
                          size="sm" icon={<Images size={12} />}
                          loading={zipBusy}
                          disabled={zipBusy}
                          onClick={() => { void downloadPhotos(openPacks, row, pack); }}
                        >
                          Download photos (zip)
                        </Button>
                      </div>
                    )}

                    {pack.issues.length > 0 && (
                      <ul className="mkx-issues mkx-issues--pack">
                        {pack.issues.map((issue, i) => (
                          <li key={`${issue.field}-${i}`} className={`mkx-issue mkx-issue--${issue.level}`}>
                            <span className="mkx-issue-text">{issue.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Memoized for the same reason Step 4's exporter is: App re-renders on every
 *  store write, and this panel runs ten adapters over every listing. App passes
 *  `useEventCallback` handlers and its memoized `step4ExportItems`, so the memo
 *  actually holds (AGENTS.md §18 #24). */
export const MarketplaceExport = memo(MarketplaceExportInner);
export default MarketplaceExport;
