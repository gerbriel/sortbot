import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowRight, BarChart3, Boxes, FolderOpen, Images, Inbox, LayoutGrid, LifeBuoy,
  MessageSquare, Package, Play, Store, Upload, Users,
} from 'lucide-react';
import {
  Badge, Button, ConfirmAction, EmptyState, Skeleton, StatGrid, StatTile,
} from './ui';
import type { WorkspaceNavItem } from './WorkspaceMenu';
import type { ClothingItem } from '../App';
import {
  batchSummary, publicationCounts, recentBatchRows, storageReadout,
  type PublicationCounts, type RecentBatchRow,
} from '../lib/home';
import { getWorkflowBatch, fetchWorkflowBatchesMeta } from '../lib/workflowBatchService';
import type { WorkflowBatch } from '../lib/workflowBatchService';
import {
  fetchOrgMarketplaces, fetchPublications, marketplaceName,
} from '../lib/marketplaceService';
import type { MarketplaceKey } from '../lib/marketplaces/types';
import { fetchAnalyticsSummary } from '../lib/analytics';
import type { AnalyticsSummary } from '../lib/analytics';
import { useSupportThreads } from '../lib/supportStore';
import { formatRelative } from '../lib/supportService';
import { resumeStep, STEP_LABELS, type WorkflowStep } from '../lib/phoneSteps';
import { log } from '../lib/debugLogger';
import './HomeDashboard.css';

/* ════════════════════════════════════════════════════════════════════════════
   HOME — the page a signed-in member lands on.

   WHY IT EXISTS: the app opened straight into Step 1 of the workflow, so every
   other thing it can do (labels, the scanner, the inbox, presets, the
   marketplaces matrix) was reachable only from a menu, and there was no way to
   put a batch down. This is the "put it down / pick something else up" surface.

   WHAT "EXIT BATCH" MEANS HERE. Nothing is torn down. The workflow is PARKED
   behind `hidden` on <main> exactly as it is behind every tool view
   (AGENTS.md §6) — uploads in flight, the grouper's selection and Step 3's
   debounced saves all keep running while this page is showing, and Resume is a
   re-reveal, not a re-open. The only control that actually ends a batch is
   "Start a new batch", and it is a two-step ConfirmAction because it is not
   reversible.

   IT IS NOT A ToolView. Every tool view leads with "Back to workflow", and
   there is nothing to go back FROM on the page you arrive at — a Back control
   here would be a lie. It borrows ToolView's spacing scale (HomeDashboard.css
   restates the numbers with the reason) and nothing else.

   EVERY WIDGET FAILS QUIET. A fetch that errors renders the widget's empty
   state, never an error wall: this is the first screen after sign-in, and a
   marketplaces table that has not been migrated yet must not be the first thing
   a new shop sees. Widgets whose feature is not installed hide entirely.
   ════════════════════════════════════════════════════════════════════════════ */

export interface HomeDashboardStorage {
  usedBytes: number;
  fileCount: number;
  loading: boolean;
  limitGb: number;
}

export interface HomeDashboardProps {
  /** Shown in the greeting line. */
  userEmail: string | null;
  userId: string;
  orgName: string | null;
  /** Null in legacy (pre-tenancy) mode — the marketplaces widget hides. */
  orgId: string | null;
  /** Founding-workspace owner/admin: drives the inbox role and the pulse widget. */
  isFounder: boolean;
  /** App's ONE nav list. Quick actions are filtered from it, so role gates are
   *  declared exactly once (AGENTS.md §6). */
  navItems: WorkspaceNavItem[];
  activeBatchId: string | null;
  /** App does not hold a batch NAME in state, so the widget resolves it from
   *  the metadata it is already fetching and falls back to this. */
  activeBatchNumber: string | null;
  /** `processedItems` — the store array, already referentially stable. */
  items: ClothingItem[];
  /** App increments this on upload / group / save; the widgets re-read on it. */
  refreshTrigger: number;
  storage: HomeDashboardStorage | null;
  /** Reveal the workflow on `step`. Also the "Upload photos" action, with 1. */
  onResume: (step: WorkflowStep) => void;
  /** Ends the session without a window.confirm — App's `startNewBatch`. */
  onStartNewBatch: () => void;
  /** App's existing `handleOpenBatch`. The row resolves the full row first. */
  onOpenBatch: (batch: WorkflowBatch) => void;
  /** Any `ActiveView` id. */
  onNavigate: (id: string) => void;
  /** Workspace dashboard, on its Marketplaces tab (App's one-shot tab hint). */
  onOpenMarketplaces: () => void;
}

/* ── Widget shell ───────────────────────────────────────────────────────────
   Module scope, not a nested function: a component declared inside another
   component is a new type on every render, so React remounts its whole subtree
   (and `react-hooks/static-components` rejects it). */

function HomeCard(
  { title, icon, action, children, span }:
  { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode; span?: boolean },
) {
  return (
    <section className={`home-card${span ? ' home-card--wide' : ''}`}>
      <div className="home-card-head">
        <h2 className="home-card-title">
          <span aria-hidden="true" className="home-card-icon">{icon}</span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Three grey bars — one widget's worth of "still loading", no spinner. */
function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="home-skeleton">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} shape="text" width={i === lines - 1 ? '60%' : '100%'} height="1.8rem" />
      ))}
    </div>
  );
}

/* ── Async widget state ─────────────────────────────────────────────────────
   Four independent pieces rather than one, so a slow marketplaces read cannot
   hold the recent-batches list behind it. `hidden` is a real state: it means
   "this feature is not installed in this workspace", which is different from
   "installed and empty" and must not render an empty state inviting the user
   to use something that is not there. */

type Loadable<T> = { status: 'loading' } | { status: 'hidden' } | { status: 'ok'; data: T };
/** Recent batches can never be "not installed" — a workspace always has them. */
type Settling<T> = { status: 'loading' } | { status: 'ok'; data: T };

const LOADING = { status: 'loading' } as const;
const HIDDEN = { status: 'hidden' } as const;

interface MarketplacesData {
  enabled: MarketplaceKey[];
  counts: PublicationCounts | null;
}

function HomeDashboard({
  userEmail, userId, orgName, orgId, isFounder, navItems,
  activeBatchId, activeBatchNumber, items, refreshTrigger, storage,
  onResume, onStartNewBatch, onOpenBatch, onNavigate, onOpenMarketplaces,
}: HomeDashboardProps) {
  const [recent, setRecent] = useState<Settling<RecentBatchRow[]>>(LOADING);
  /** The open batch's own display name, read out of the same metadata call. */
  const [activeName, setActiveName] = useState<string | null>(null);
  const [markets, setMarkets] = useState<Loadable<MarketplacesData>>(LOADING);
  const [pulse, setPulse] = useState<Loadable<AnalyticsSummary>>(LOADING);
  /** The row whose full batch row is being fetched, so it can say so. */
  const [openingId, setOpeningId] = useState<string | null>(null);

  // The thread list comes from the SHARED store, which owns the one Realtime
  // channel and the one poll and reference-counts them (AGENTS.md §18 #27).
  // Mounting the hook is the subscription — never subscribe from here.
  const { sorted: threads, unreadCount, available: msgAvailable } =
    useSupportThreads(isFounder ? 'founder' : 'user', userId);

  const summary = useMemo(() => batchSummary(items), [items]);
  const hasBatch = !!activeBatchId && summary.photos > 0;
  const step = useMemo(() => resumeStep(items), [items]);

  /* ── Fetches ────────────────────────────────────────────────────────────
     One effect, three reads, one cancel flag. Re-runs on `refreshTrigger`
     because App already increments it on exactly the events that change these
     numbers (an upload, a group change, a save, a batch delete). */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const meta = await fetchWorkflowBatchesMeta();
        if (cancelled) return;
        setRecent({ status: 'ok', data: recentBatchRows(meta, activeBatchId, 5) });
        // The open batch is filtered OUT of the rows above (it has its own
        // widget), so its name is read from the same response rather than
        // costing App a piece of state it has never needed.
        const mine = activeBatchId ? meta.find(b => b.id === activeBatchId) : undefined;
        setActiveName(mine ? recentBatchRows([mine], null, 1)[0]?.name ?? null : null);
      } catch (err) {
        // Quiet on purpose: an empty list reads as "no other batches", which is
        // the truthful thing to show when we could not find out.
        log.error(`HomeDashboard | recent batches failed: ${String(err)}`);
        if (!cancelled) setRecent({ status: 'ok', data: [] });
      }
    })();

    if (!orgId) {
      setMarkets(HIDDEN);
    } else {
      void (async () => {
        const res = await fetchOrgMarketplaces(orgId);
        if (cancelled) return;
        if (res.status !== 'ok') { setMarkets(HIDDEN); return; }
        const enabled = res.rows.filter(r => r.enabled).map(r => r.marketplace);
        if (enabled.length === 0) { setMarkets(HIDDEN); return; }
        let counts: PublicationCounts | null = null;
        if (activeBatchId) {
          const pubs = await fetchPublications(orgId, activeBatchId);
          if (cancelled) return;
          if (pubs.status === 'ok') counts = publicationCounts(pubs.rows);
        }
        setMarkets({ status: 'ok', data: { enabled, counts } });
      })();
    }

    if (!isFounder) {
      setPulse(HIDDEN);
    } else {
      void (async () => {
        const res = await fetchAnalyticsSummary(7);
        if (cancelled) return;
        setPulse(res.status === 'ok' ? { status: 'ok', data: res.summary } : HIDDEN);
      })();
    }

    return () => { cancelled = true; };
  }, [orgId, activeBatchId, refreshTrigger, isFounder]);

  /* Opening a recent batch needs the FULL row: `fetchWorkflowBatchesMeta`
     projects `workflow_state` away (it is the ~54MB column), and handing
     handleOpenBatch a row without it would send it down the DB-rebuild path
     instead of the restore path. One extra read, on click only. */
  const openingRef = useRef(false);
  const openRecent = async (id: string) => {
    if (openingRef.current) return;   // double-click guard, same reason as isOpeningBatchRef
    openingRef.current = true;
    setOpeningId(id);
    try {
      const full = await getWorkflowBatch(id);
      if (full) onOpenBatch(full);
    } catch (err) {
      log.error(`HomeDashboard | open batch ${id} failed: ${String(err)}`);
    } finally {
      openingRef.current = false;
      setOpeningId(null);
    }
  };

  /* ── Quick actions ──────────────────────────────────────────────────────
     Built FROM navItems, in a fixed display order, so a role gate lives in one
     place. `phoneOnly` rows (the shortcuts stand-in) are dropped — this page is
     not where they belong, and they have no view to open. */
  const quickActions = useMemo(() => {
    const ORDER = [
      'products', 'labels', 'scan', 'library', 'categories', 'presets', 'workspace',
      'vocabulary', 'analytics', 'crm', 'finance', 'board',
    ];
    const byId = new Map(navItems.filter(i => !i.phoneOnly).map(i => [i.id, i]));
    const tiles: Array<{ id: string; label: string; icon: ReactNode; title: string; run: () => void }> = [];
    for (const id of ORDER) {
      const found = byId.get(id);
      if (!found) continue;
      tiles.push({ id, label: found.label, icon: found.icon, title: found.title, run: () => onNavigate(id) });
      // Marketplaces is not a view of its own — it is the Workspace dashboard on
      // a particular tab — so it rides alongside the row that opens that page.
      if (id === 'workspace') {
        tiles.push({
          id: 'marketplaces', label: 'Marketplaces', icon: <Store size={16} />,
          title: 'Marketplaces — choose where this workspace lists', run: onOpenMarketplaces,
        });
      }
    }
    return tiles;
  }, [navItems, onNavigate, onOpenMarketplaces]);

  const store = storage ? storageReadout(storage.usedBytes, storage.limitGb) : null;
  const greetingName = userEmail ? userEmail.split('@')[0] : null;

  return (
    <div className="home-view">
      <div className="home-inner">
        <header className="home-head">
          <h1 className="home-title">
            {greetingName ? `Welcome back, ${greetingName}` : 'Welcome back'}
          </h1>
          <p className="home-sub">
            {orgName ? <>{orgName} — pick up where you left off, or start something else.</>
              : <>Pick up where you left off, or start something else.</>}
          </p>
        </header>

        <div className="home-grid">
          {/* ── 1. The open batch ─────────────────────────────────────────── */}
          <HomeCard title="Current batch" icon={<Images size={16} />} span>
            {hasBatch ? (
              <>
                <p className="home-batch-name">{activeName || activeBatchNumber || 'Untitled batch'}</p>
                <p className="home-batch-step">
                  Step {step} — {STEP_LABELS[step].long}
                </p>
                <StatGrid className="home-stats">
                  <StatTile quiet compact label="Photos" value={summary.photos} />
                  <StatTile quiet compact label="Groups" value={summary.groups} />
                  <StatTile quiet compact label="Listings" value={summary.listings}
                    hint={`${summary.categorized} categorized`} />
                </StatGrid>
                <div className="home-actions">
                  <Button variant="primary" icon={<Play size={14} />} onClick={() => onResume(step)}>
                    Resume batch
                  </Button>
                  {/* Not window.confirm (Do Not #12): it blocks the event loop
                      mid-auto-save, and this is the one control here that
                      detaches a session. */}
                  <ConfirmAction
                    label="Start a new batch"
                    size="md"
                    tone="neutral"
                    confirmLabel="Start new"
                    prompt="Put this batch down and start a new one? Unsaved products will be lost."
                    onConfirm={onStartNewBatch}
                  />
                </div>
              </>
            ) : (
              <EmptyState
                inline
                icon={<Upload size={22} />}
                title="No batch open"
                description="Drop in a folder of photos — or take them on your phone — and Arcadian will walk you through grouping, describing and exporting them."
                actions={
                  <Button variant="primary" icon={<Upload size={14} />} onClick={() => onResume(1)}>
                    Upload photos
                  </Button>
                }
              />
            )}
          </HomeCard>

          {/* ── 2. Recent batches ─────────────────────────────────────────── */}
          <HomeCard
            title="Recent batches"
            icon={<FolderOpen size={16} />}
            action={
              <button type="button" className="home-link" onClick={() => onNavigate('library')}>
                All batches <ArrowRight size={12} />
              </button>
            }
          >
            {recent.status === 'loading' ? (
              <CardSkeleton />
            ) : recent.data.length === 0 ? (
              <EmptyState
                inline
                icon={<Package size={22} />}
                title="Nothing else saved yet"
                description="Every batch you start shows up here and in the Library."
              />
            ) : (
              <ul className="home-list">
                {recent.data.map(row => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="home-row"
                      onClick={() => { void openRecent(row.id); }}
                      disabled={openingId !== null}
                    >
                      <span className="home-row-main">
                        <span className="home-row-name">{row.name}</span>
                        <span className="home-row-meta">
                          Step {row.step} — {STEP_LABELS[row.step as WorkflowStep].short}
                          {' · '}{row.photos} photo{row.photos === 1 ? '' : 's'}
                          {' · '}{formatRelative(row.updatedAt)}
                        </span>
                      </span>
                      <span className="home-row-go" aria-hidden="true">
                        {openingId === row.id ? 'Opening…' : <ArrowRight size={14} />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </HomeCard>

          {/* ── 3. Inbox. Hidden until the messaging migration has been run. ── */}
          {msgAvailable !== false && (
            <HomeCard
              title={isFounder ? 'Inbox' : 'Messages'}
              icon={<Inbox size={16} />}
              action={
                unreadCount > 0
                  ? <Badge tone="danger" live>{unreadCount} unread</Badge>
                  : undefined
              }
            >
              {msgAvailable === null ? (
                <CardSkeleton lines={2} />
              ) : threads.length === 0 ? (
                <EmptyState
                  inline
                  icon={<MessageSquare size={22} />}
                  title={isFounder ? 'No conversations yet' : 'No messages yet'}
                  description={isFounder
                    ? 'Anything a shop sends lands here.'
                    : 'Ask us anything — setup, a stuck batch, a listing that will not export.'}
                  actions={
                    <Button onClick={() => onNavigate('messages')}>
                      {isFounder ? 'Open inbox' : 'Start a conversation'}
                    </Button>
                  }
                />
              ) : (
                <>
                  <ul className="home-list">
                    {threads.slice(0, 3).map(t => (
                      <li key={t.id}>
                        <button type="button" className="home-row" onClick={() => onNavigate('messages')}>
                          <span aria-hidden="true" className="home-row-icon">
                            {t.kind === 'team' ? <Users size={14} /> : <LifeBuoy size={14} />}
                          </span>
                          <span className="home-row-main">
                            <span className="home-row-name">
                              {t.kind === 'team'
                                ? (t.subject || 'Team conversation')
                                : isFounder ? (t.user_email || 'A customer') : 'Customer support'}
                            </span>
                            <span className="home-row-meta">
                              {t.last_message_preview || 'No messages yet'}
                            </span>
                          </span>
                          <span className="home-row-go">{formatRelative(t.last_message_at)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="home-actions">
                    <Button onClick={() => onNavigate('messages')}>
                      {isFounder ? 'Open inbox' : 'Open messages'}
                    </Button>
                  </div>
                </>
              )}
            </HomeCard>
          )}

          {/* ── 4. Quick actions ──────────────────────────────────────────── */}
          <HomeCard title="Tools" icon={<LayoutGrid size={16} />} span>
            <div className="home-tiles">
              {quickActions.map(tile => (
                <button key={tile.id} type="button" className="home-tile" title={tile.title} onClick={tile.run}>
                  <span aria-hidden="true" className="home-tile-icon">{tile.icon}</span>
                  <span className="home-tile-label">{tile.label}</span>
                </button>
              ))}
            </div>
          </HomeCard>

          {/* ── 5. Storage ────────────────────────────────────────────────── */}
          {store && (
            <HomeCard title="Storage" icon={<Boxes size={16} />}>
              <StatGrid className="home-stats">
                <StatTile
                  quiet compact
                  label="Used"
                  value={`${store.usedGb} GB`}
                  hint={store.limitGb > 0 ? `of ${store.limitGb} GB` : undefined}
                />
                <StatTile quiet compact label="Photos stored" value={storage?.fileCount ?? 0} />
              </StatGrid>
              {store.limitGb > 0 && (
                <div className="home-meter">
                  <div
                    className={`home-meter-bar${store.nearLimit ? ' home-meter-bar--warn' : ''}`}
                    style={{ width: `${store.percent}%` }}
                  />
                </div>
              )}
              <p className="home-note">
                {storage?.loading
                  ? 'Re-reading…'
                  : store.limitGb > 0
                    ? `${store.percent}% of your plan${store.nearLimit ? ' — nearly full' : ''}`
                    : 'No plan limit set'}
              </p>
            </HomeCard>
          )}

          {/* ── 6. Marketplaces. Hidden pre-migration and when none is on. ─── */}
          {markets.status !== 'hidden' && (
            <HomeCard
              title="Marketplaces"
              icon={<Store size={16} />}
              action={
                <button type="button" className="home-link" onClick={onOpenMarketplaces}>
                  Manage <ArrowRight size={12} />
                </button>
              }
            >
              {markets.status === 'loading' ? (
                <CardSkeleton lines={2} />
              ) : (
                <>
                  <div className="home-chips">
                    {markets.data.enabled.map(key => (
                      <Badge key={key} tone="neutral">{marketplaceName(key)}</Badge>
                    ))}
                  </div>
                  {markets.data.counts ? (
                    <StatGrid className="home-stats">
                      <StatTile quiet compact label="Posted" value={markets.data.counts.posted} />
                      <StatTile quiet compact label="Exported" value={markets.data.counts.exported} />
                      <StatTile quiet compact label="Sold" value={markets.data.counts.sold} />
                    </StatGrid>
                  ) : (
                    <p className="home-note">Open a batch to see where its listings have gone.</p>
                  )}
                  {markets.data.counts && (
                    <div className="home-actions">
                      <Button onClick={() => onResume(4)}>Go to export</Button>
                    </div>
                  )}
                </>
              )}
            </HomeCard>
          )}

          {/* ── 7. Founder pulse ──────────────────────────────────────────── */}
          {pulse.status !== 'hidden' && (
            <HomeCard title="Last 7 days" icon={<BarChart3 size={16} />}>
              {pulse.status === 'loading' ? (
                <CardSkeleton lines={2} />
              ) : (
                <>
                  <StatGrid className="home-stats">
                    <StatTile quiet compact label="Pageviews" value={pulse.data.totals.pageviews} />
                    <StatTile quiet compact label="Sessions" value={pulse.data.totals.sessions} />
                    <StatTile quiet compact label="Beta signups" value={pulse.data.totals.beta_signups} />
                  </StatGrid>
                  <div className="home-actions">
                    <Button onClick={() => onNavigate('analytics')}>Open analytics</Button>
                  </div>
                </>
              )}
            </HomeCard>
          )}
        </div>
      </div>
    </div>
  );
}

export default HomeDashboard;
