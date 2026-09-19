import { useCallback, useEffect, useMemo, useState } from 'react';
import { Circle, CircleCheck, ListChecks } from 'lucide-react';
import { Badge, Button, ConfirmAction } from './ui';
import {
  deriveOnboardingSteps, onboardingProgress, readOnboardingLocal, writeOnboardingLocal,
  type OnboardingAction, type OnboardingFacts,
} from '../lib/onboarding';
import type { OrgRole } from '../lib/orgService';
import type { WorkflowStep } from '../lib/phoneSteps';
import { getCategories } from '../lib/categoriesService';
import { getCategoryPresets } from '../lib/categoryPresetsService';
import { fetchOrgMarketplaces, fetchPublications } from '../lib/marketplaceService';
import { getShopifyConnection } from '../lib/shopifyConnectionService';
import { fetchOrgMembers } from '../lib/orgService';
import { fetchWorkflowBatchesMeta } from '../lib/workflowBatchService';
import { log } from '../lib/debugLogger';
import './OnboardingChecklist.css';

/* ════════════════════════════════════════════════════════════════════════════
   GET SET UP — the first-run checklist, first widget on Home.

   WHY IT EXISTS: an approved shop signs in, `ensureOrganization` mints their
   workspace and seeds its categories, and they land on a dashboard that tells
   them nothing about what to do next. The shop name that becomes the Shopify
   Vendor column, the marketplaces Step 4 will offer, the teammate who is going
   to do the photographing — every one of those lives behind a menu row somebody
   has to think to open.

   WHAT IT REFUSES TO DO
   - It never guesses. Every read fails quiet into "unknown", and unknown is
     never "done" (lib/onboarding.ts, rule 1) — so a flaky connection leaves a
     step on the list rather than silently ticking it off.
   - It never shows a step the user cannot take. A feature whose migration has
     not been run is ABSENT, and so is a step whose write RLS would refuse this
     role.
   - It never flashes. The card renders nothing until the facts have settled, so
     an established workspace — which will be every workspace within a week —
     sees no checklist appear and then vanish on every page load.
   - It retires itself. Once every REQUIRED step is done it returns null for
     good; "Hide this checklist" is for a shop that wants it gone sooner.

   COST: up to six projected reads, two of which Home also makes. That
   duplication is real and deliberate — it is paid only while setup is
   unfinished, which is exactly the window where an extra round trip matters
   least, and the alternative is threading six facts through HomeDashboard's
   props for a widget that deletes itself.
   ════════════════════════════════════════════════════════════════════════════ */

export interface OnboardingChecklistProps {
  /** Null in legacy (pre-tenancy) mode — the checklist does not render. */
  orgId: string | null;
  orgName: string | null;
  /** `organizations.plan`. `beta` earns the founding-pricing badge. */
  plan: string | null;
  role: OrgRole;
  /** Owner/admin — the only roles `org_invites` INSERT accepts. */
  canInvite: boolean;
  /** `description_settings.vendorName` is set. A prop: App already has it, and
   *  saving it must tick the step without a refetch. */
  hasVendorName: boolean;
  /** App's `libraryRefreshTrigger` — re-reads on upload / group / save / delete. */
  refreshTrigger: number;
  onNavigate: (id: string) => void;
  /** The Workspace dashboard on its Marketplaces tab — not a view of its own. */
  onOpenMarketplaces: () => void;
  /** Un-parks `<main>` on a step. */
  onStartWorkflow: (step: WorkflowStep) => void;
}

/** The half of the facts that comes off the network. The rest are props. */
type FetchedFacts = Pick<
  OnboardingFacts,
  'categoryCount' | 'presetCount' | 'visitedCategories' | 'visitedPresets'
  | 'marketplaces' | 'shopify' | 'memberCount' | 'batchCount' | 'exportedCount'
>;

/** A plan's badge text. `beta` is the founding cohort — say what they bought. */
function planLabel(plan: string | null): string | null {
  const p = (plan ?? '').trim().toLowerCase();
  if (!p) return null;
  if (p === 'beta') return 'Beta · founding pricing for life';
  if (p === 'free') return 'Free plan';
  return `${p.charAt(0).toUpperCase()}${p.slice(1)} plan`;
}

function OnboardingChecklist({
  orgId, orgName, plan, role, canInvite, hasVendorName, refreshTrigger,
  onNavigate, onOpenMarketplaces, onStartWorkflow,
}: OnboardingChecklistProps) {
  /* The facts carry the workspace they were read for, and `dismissed` carries
     the workspace it was clicked in, so BOTH are derived at render rather than
     corrected in an effect: switching workspace can never show one workspace's
     checklist against another's facts, and there is no synchronous setState in
     the effect body to cascade a render (react-hooks/set-state-in-effect). */
  const [settled, setSettled] = useState<{ orgId: string; facts: FetchedFacts } | null>(null);
  const [dismissedIn, setDismissedIn] = useState<string | null>(null);

  useEffect(() => {
    // Not `return` + setState: an absent workspace, or one that has dismissed
    // the checklist, simply never settles — and reads nothing, which is the
    // point of testing the local record before touching the network.
    if (!orgId) return;
    const local = readOnboardingLocal(orgId);
    if (local.hidden) return;

    let cancelled = false;
    const admin = role === 'owner' || role === 'admin';

    void (async () => {
      /* Each read is independently guarded. A rejection is a fact we do not
         have, never an error the user is shown — this widget is the first thing
         on the first screen after sign-in. */
      const settle = async <T,>(what: string, run: () => Promise<T>, fallback: T): Promise<T> => {
        try { return await run(); } catch (err) {
          log.error(`OnboardingChecklist | ${what} failed: ${String(err)}`);
          return fallback;
        }
      };

      const [cats, presets, markets, shop, members, meta] = await Promise.all([
        settle('categories', getCategories, [] as Awaited<ReturnType<typeof getCategories>>),
        settle('presets', getCategoryPresets, [] as Awaited<ReturnType<typeof getCategoryPresets>>),
        admin
          ? settle('marketplaces', () => fetchOrgMarketplaces(orgId), { status: 'unavailable' } as const)
          : Promise.resolve({ status: 'unavailable' } as const),
        admin
          ? settle('shopify', () => getShopifyConnection(orgId), { status: 'unavailable' } as const)
          : Promise.resolve({ status: 'unavailable' } as const),
        // Only asked for when it can change an answer: a member who cannot
        // invite never sees that step, so the roster is none of this widget's
        // business.
        canInvite
          ? settle('members', () => fetchOrgMembers(orgId), [] as Awaited<ReturnType<typeof fetchOrgMembers>>)
          : Promise.resolve([]),
        settle('batches', fetchWorkflowBatchesMeta, [] as Awaited<ReturnType<typeof fetchWorkflowBatchesMeta>>),
      ]);
      if (cancelled) return;

      const marketplaces: FetchedFacts['marketplaces'] = markets.status === 'ok'
        ? markets.rows.filter(r => r.enabled).length
        : 'unavailable';
      const shopify: FetchedFacts['shopify'] = shop.status === 'unavailable'
        ? 'unavailable'
        : shop.status === 'connected';

      /* A batch that reached Step 4 is the cheap proof of an export, and it
         costs nothing because the metadata is already in hand. The publication
         rows are the second answer, and are only asked for when the first one
         came back empty — a shop that has exported to Shopify never pays it. */
      let exportedCount = meta.filter(b => (b.current_step ?? 0) >= 4).length;
      if (exportedCount === 0 && marketplaces !== 'unavailable') {
        const pubs = await settle(
          'publications', () => fetchPublications(orgId), { status: 'unavailable' } as const,
        );
        if (cancelled) return;
        if (pubs.status === 'ok') exportedCount = pubs.rows.length;
      }

      setSettled({ orgId, facts: {
        categoryCount: cats.length,
        presetCount: presets.length,
        visitedCategories: local.visitedCategories === true,
        visitedPresets: local.visitedPresets === true,
        marketplaces,
        shopify,
        memberCount: members.length,
        batchCount: meta.length,
        exportedCount,
      } });
    })();

    return () => { cancelled = true; };
  }, [orgId, role, canInvite, refreshTrigger]);

  /** Facts for THIS workspace only — a stale set never renders for a beat. */
  const fetched = settled && settled.orgId === orgId ? settled.facts : null;

  const steps = useMemo(
    () => (fetched ? deriveOnboardingSteps({ ...fetched, hasVendorName, canInvite, role }) : []),
    [fetched, hasVendorName, canInvite, role],
  );
  const progress = useMemo(() => onboardingProgress(steps), [steps]);

  const run = useCallback((action: OnboardingAction) => {
    if (action.kind === 'navigate') onNavigate(action.view);
    else if (action.kind === 'marketplaces') onOpenMarketplaces();
    else onStartWorkflow(action.step);
  }, [onNavigate, onOpenMarketplaces, onStartWorkflow]);

  const dismiss = useCallback(() => {
    writeOnboardingLocal(orgId, { hidden: true });
    setDismissedIn(orgId);
  }, [orgId]);

  const dismissed = !!orgId && dismissedIn === orgId;
  if (dismissed || !fetched || steps.length === 0 || progress.complete) return null;

  // The greeting is for a workspace that has never had a batch in it. After
  // that the shop is working, and being welcomed again reads as the app not
  // knowing who it is talking to.
  const fresh = fetched.batchCount === 0;
  const heading = fresh && orgName ? `Welcome to Arcadian, ${orgName}` : 'Get set up';
  const badge = planLabel(plan);

  return (
    <section className="home-card home-card--wide onb-card" aria-labelledby="onb-heading">
      <div className="home-card-head onb-head">
        <h2 className="home-card-title" id="onb-heading">
          <span aria-hidden="true" className="home-card-icon"><ListChecks size={16} /></span>
          <span className="onb-heading-text">{heading}</span>
        </h2>
        <div className="onb-head-right">
          {badge && <Badge tone="accent">{badge}</Badge>}
          <span className="onb-count">{progress.done} of {progress.total} done</span>
        </div>
      </div>

      {fresh && (
        <p className="onb-intro">
          A few minutes here and every listing after this one comes out the way you want it.
          Nothing is locked — you can start uploading straight away.
        </p>
      )}

      <ol className="onb-list">
        {steps.map(s => (
          <li key={s.id} className={`onb-step${s.done ? ' onb-step--done' : ''}`}>
            <span aria-hidden="true" className="onb-mark">
              {s.done ? <CircleCheck size={18} /> : <Circle size={18} />}
            </span>
            <div className="onb-body">
              <p className="onb-step-title">
                {s.title}
                {/* A visually-hidden word, because the mark beside it is the
                    only other thing saying so and it is aria-hidden. */}
                <span className="ui-sr-only">{s.done ? ' — done' : ' — still to do'}</span>
                {s.optional && <span className="onb-optional">Optional</span>}
              </p>
              {/* A finished step keeps its title and loses its reasoning: the
                  sentence existed to talk someone into doing it, and seven of
                  them is a card that grows as the work shrinks. It also keeps
                  every line of prose on this card above the AA contrast floor
                  — there is no greyed-out body text left to fail it. */}
              {!s.done && <p className="onb-why">{s.why}</p>}
            </div>
            {!s.done && (
              <div className="onb-action">
                {/* `md`, not the `sm` of a dense row: these are the page's
                    invitations on a shop's first screen, and they match the
                    button scale of every other Home widget. */}
                <Button onClick={() => run(s.action)}>{s.action.label}</Button>
              </div>
            )}
          </li>
        ))}
      </ol>

      <footer className="onb-foot">
        {/* Two-step, not a window.confirm (Do Not #12) — and `neutral` because
            nothing is destroyed, it just stops being offered. */}
        <ConfirmAction
          label="Hide this checklist"
          tone="neutral"
          size="sm"
          confirmLabel="Hide it"
          prompt="Hide the setup checklist? Everything on it stays reachable from the menu."
          onConfirm={dismiss}
        />
      </footer>
    </section>
  );
}

export default OnboardingChecklist;
