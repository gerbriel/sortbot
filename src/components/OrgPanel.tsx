import { useEffect, useMemo, useRef, useState } from 'react';
import { Users, X, Pencil, Check, Copy, LogOut, Trash2, ChevronRight, ChevronDown, ShoppingBag, Tags, ArrowUp, ArrowDown, Plus, Store, Globe, ShieldCheck, Image as ImageIcon } from 'lucide-react';
import {
  fetchOrgMembers, fetchOrgInvites, inviteToOrg, revokeInvite, removeMember,
  renameOrganization, updateMemberRole, fetchMemberActivity,
  type Organization, type OrgRole, type OrgMemberRow, type OrgInviteRow, type MemberActivity,
} from '../lib/orgService';
// Only the member-detail expand needs this now: a member's own beta
// application is per-WORKSPACE context. The request queue, the workspace
// directory and cross-workspace user management all moved to the Founder
// console (src/components/FounderConsole.tsx).
import { fetchBetaSignups, type BetaSignupRow } from '../lib/betaService';
import {
  getShopifyConnection, saveShopifyConnection, deleteShopifyConnection,
  type ShopifyConnectionStatus,
} from '../lib/shopifyConnectionService';
import {
  getOrgDescriptionSettings, saveOrgDescriptionSettings,
  DEFAULT_DESCRIPTION_SETTINGS, DEFAULT_BACKGROUND_PRESET,
  BACKGROUND_COLORS, BACKGROUND_PADDING_MAX,
  BACKGROUND_QUALITY_MIN, BACKGROUND_QUALITY_MAX,
  normalizeBackgroundColor, presetHash,
  type DescriptionSettings, type BackgroundPreset, type BackgroundAnchor,
} from '../lib/descriptionSettings';
import {
  PLATFORM_PRESETS, ADJUSTMENT_TYPES, ROUNDING_MODES, MAX_PERCENT, MAX_FIXED,
  platformSlug, pricingExample, describePlatformRule, selectablePlatforms,
  type PlatformPricingRule, type PriceAdjustmentType, type PriceRounding,
} from '../lib/platformPricing';
import {
  fetchOrgMarketplaces, setMarketplaceEnabled, updateMarketplaceSettings,
  fetchVocab, upsertVocab, updateVocab, deleteVocab,
  marketplaceName, normalizeMarketplaceSettings,
  VOCAB_KINDS, VOCAB_KIND_LABELS,
  type OrgMarketplaceRow, type VocabRow, type MarketplaceSettings,
} from '../lib/marketplaceService';
import {
  MARKETPLACE_KEYS, CONDITION_GRADES,
  type MarketplaceKey, type VocabKind,
} from '../lib/marketplaces/types';
import './OrgPanel.css';

/* ── Photo-background preview ───────────────────────────────────────────────
 *
 * THE SAME FIT MATH THE SERVICE USES, drawn at 200px over a placeholder
 * garment. A preset is six numbers and nobody reasons about "0.12 padding,
 * anchored top" in the abstract — the preview is the control. It is a stand-in
 * shape rather than a real photo on purpose: the Settings tab has no batch open
 * and no photo to borrow, and a placeholder that obeys the same arithmetic
 * answers the only question being asked (how much margin, where does it sit).
 *
 * If the geometry here and the service's ever disagree, THIS is wrong — the
 * composite is what ships. Keep the three steps in this order: fill the canvas,
 * compute the inner box from the padding fraction, fit the subject into it
 * preserving its aspect, then anchor it.
 */
const BG_PREVIEW_PX = 200;
/** A hanging garment is taller than it is wide; 3:4 is the common camera-roll shape. */
const BG_SUBJECT_ASPECT = 3 / 4;

function drawBackgroundPreview(canvas: HTMLCanvasElement, preset: BackgroundPreset): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = BG_PREVIEW_PX * dpr;
  canvas.height = BG_PREVIEW_PX * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, BG_PREVIEW_PX, BG_PREVIEW_PX);

  // 1. the backdrop
  ctx.fillStyle = normalizeBackgroundColor(preset.color);
  ctx.fillRect(0, 0, BG_PREVIEW_PX, BG_PREVIEW_PX);

  // 2. the inner box the subject must fit inside
  const pad = BG_PREVIEW_PX * Math.max(0, Math.min(BACKGROUND_PADDING_MAX, preset.padding));
  const innerW = BG_PREVIEW_PX - pad * 2;
  const innerH = BG_PREVIEW_PX - pad * 2;
  if (innerW <= 0 || innerH <= 0) return;

  // 3. fit preserving aspect, then anchor
  let w = innerW;
  let h = w / BG_SUBJECT_ASPECT;
  if (h > innerH) { h = innerH; w = h * BG_SUBJECT_ASPECT; }
  const x = pad + (innerW - w) / 2;
  const y = preset.anchor === 'top' ? pad : pad + (innerH - h) / 2;

  if (preset.shadow) {
    ctx.save();
    ctx.filter = 'blur(4px)';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h + 3, w * 0.38, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The placeholder subject: a rounded rect with a neck notch, enough to read
  // as a garment without pretending to be a photo.
  const r = Math.min(w, h) * 0.12;
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  // neck notch, cut out of the shape so the backdrop shows through
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y, w * 0.16, h * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

interface OrgPanelProps {
  org: Organization;
  myRole: OrgRole;
  myUserId: string;
  onClose: () => void;
  /** Fired after a successful rename so App can refresh the header button. */
  onOrgUpdated?: (org: Organization) => void;
  /** Fired when the signed-in user's own role changes (promote/demote self). */
  onMyRoleChanged?: (role: OrgRole) => void;
  /** Fired after the user leaves the workspace — App should re-bootstrap. */
  onLeftWorkspace?: () => void;
  /** Tab to open on. Analytics / CRM / Errors are top-level views of their own
   *  now, and since Sept 2026 so are beta requests, the workspace directory and
   *  cross-workspace users — see onOpenFounder. */
  initialTab?: 'members' | 'settings' | 'marketplaces';
  /** Founding admins only: opens the Founder console, which is where the three
   *  cross-workspace sections that used to be tabs in here now live. */
  onOpenFounder?: () => void;
  /** Fired after description format settings are saved so App can refresh
   *  what it passes to Step 3's generator. */
  onDescriptionSettingsChanged?: (settings: DescriptionSettings) => void;
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;

/**
 * Workspace panel — members with role management, email invites (join on next
 * sign-in), workspace rename, leave workspace, and (Founding admins only) the
 * beta request queue with approve/deny/reopen/delete, filtering, and search.
 */
export default function OrgPanel({ org, myRole, myUserId, onClose, onOrgUpdated, onMyRoleChanged, onLeftWorkspace, onDescriptionSettingsChanged, initialTab, onOpenFounder }: OrgPanelProps) {
  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [invites, setInvites] = useState<OrgInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Dashboard tabs — Members (everyone), Settings (org admins),
  // Beta program + Users (Founding admins)
  const [panelTab, setPanelTab] = useState<'members' | 'settings' | 'marketplaces'>(initialTab ?? 'members');
  // Inline two-step confirm (no native confirm() — Do Not #12). Holds a key
  // like `remove:<userId>`, `leave`, or `beta-delete:<id>`; second click acts.
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  // Workspace rename
  const [displayName, setDisplayName] = useState(org.name);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(org.name);
  useEffect(() => { setDisplayName(org.name); }, [org.name]);

  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';
  const ownerCount = members.filter(m => m.role === 'owner').length;
  // Leaving is blocked for the last owner and for the only member (their data
  // would be stranded in a workspace nobody can reach).
  const canLeave = members.length > 1 && !(isOwner && ownerCount <= 1);

  // Beta waitlist management lives with the Founding Workspace admins only.
  const isBetaAdmin = isAdmin && org.slug === 'founding';
  const [betaSignups, setBetaSignups] = useState<BetaSignupRow[]>([]);
  // Click-to-expand member details (activity fetched lazily per member)
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [memberActivity, setMemberActivity] = useState<Record<string, MemberActivity | 'loading'>>({});

  // Per-org Shopify connection (token is write-only — see shopifyConnectionService)
  const [shopifyConn, setShopifyConn] = useState<ShopifyConnectionStatus | null>(null);
  const [shopifyDomain, setShopifyDomain] = useState('');
  const [shopifyToken, setShopifyToken] = useState('');
  const [editingShopify, setEditingShopify] = useState(false);

  // Listing description format (loaded ONCE — action reloads must not clobber
  // unsaved edits in the form below)
  const [descLoaded, setDescLoaded] = useState(false);
  const [descSymbol, setDescSymbol] = useState(DEFAULT_DESCRIPTION_SETTINGS.measurementPrefix);
  const [descWashing, setDescWashing] = useState(DEFAULT_DESCRIPTION_SETTINGS.washingLine);
  const [descClosing, setDescClosing] = useState(DEFAULT_DESCRIPTION_SETTINGS.closingLine);
  const [descDisclaimers, setDescDisclaimers] = useState(DEFAULT_DESCRIPTION_SETTINGS.disclaimerLines.join('\n'));
  const [descHashtags, setDescHashtags] = useState(DEFAULT_DESCRIPTION_SETTINGS.includeHashtags);
  const [descVendor, setDescVendor] = useState(DEFAULT_DESCRIPTION_SETTINGS.vendorName);
  const [descProseEnabled, setDescProseEnabled] = useState(DEFAULT_DESCRIPTION_SETTINGS.proseEnabled);
  const [descProseStyle, setDescProseStyle] = useState(DEFAULT_DESCRIPTION_SETTINGS.proseStyle);
  // Marketplace price adjustments (Feature 21). Lives in the same JSONB, so it
  // is loaded and saved with the block above — one write, never two that can
  // half-apply.
  const [descPlatforms, setDescPlatforms] = useState<PlatformPricingRule[]>([]);
  /* ── Photo backgrounds (description_settings.background) ──────────────────
     One recipe per workspace, edited here and applied by the matting service
     to photos processed FROM NOW ON. */
  const [descBackground, setDescBackground] = useState<BackgroundPreset>({ ...DEFAULT_BACKGROUND_PRESET });
  const [bgHash, setBgHash] = useState('');
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // ── Marketplaces (marketplaces.sql) ───────────────────────────────────────
  // Which marketplaces this workspace sells on, and what each one calls a
  // brand / colour / condition / size / category. Members READ both; admins
  // edit the opt-in row, any member edits the workspace vocabulary (the same
  // split brand_aliases.sql uses, and for the same reason), and founding
  // admins additionally edit the GLOBAL rows every tenant consumes.
  const [mktStatus, setMktStatus] = useState<'loading' | 'ok' | 'unavailable'>('loading');
  const [mktRows, setMktRows] = useState<OrgMarketplaceRow[]>([]);
  const [vocabRows, setVocabRows] = useState<VocabRow[]>([]);
  const [vocabFilter, setVocabFilter] = useState<'all' | MarketplaceKey>('all');
  const [vocabEditId, setVocabEditId] = useState<string | null>(null);
  const [vocabEditDraft, setVocabEditDraft] = useState({ canonical: '', value: '' });
  const [vocabAdd, setVocabAdd] = useState<{
    marketplace: MarketplaceKey; kind: VocabKind; canonical: string; value: string; global: boolean;
  }>({ marketplace: 'poshmark', kind: 'brand', canonical: '', value: '', global: false });

  useEffect(() => {
    // Loaded for EVERY member, not just admins: the Marketplaces tab shows each
    // marketplace's price rule by name, and those names live in this JSONB.
    // organizations SELECT has always been membership-scoped, so this reads
    // nothing a member could not already read.
    let cancelled = false;
    getOrgDescriptionSettings(org.id).then(s => {
      if (cancelled) return;
      if (cancelled) return;
      setDescSymbol(s.measurementPrefix);
      setDescWashing(s.washingLine);
      setDescClosing(s.closingLine);
      setDescDisclaimers(s.disclaimerLines.join('\n'));
      setDescHashtags(s.includeHashtags);
      setDescVendor(s.vendorName);
      setDescProseEnabled(s.proseEnabled);
      setDescProseStyle(s.proseStyle);
      setDescPlatforms(s.platformPricing);
      setDescBackground(s.background);
      setDescLoaded(true);
    });
    return () => { cancelled = true; };
  }, [org.id]);

  /* Redraw on every change. The canvas is only mounted on the Settings tab, so
     the ref is null elsewhere and the effect is a no-op. */
  useEffect(() => {
    const canvas = bgCanvasRef.current;
    if (canvas) drawBackgroundPreview(canvas, descBackground);
  }, [descBackground, panelTab, descLoaded]);

  /* The preset hash, shown as meta. Async (crypto.subtle), so it is state; the
     cancel flag stops a slow digest from overwriting a newer one. */
  useEffect(() => {
    let cancelled = false;
    presetHash(descBackground).then(h => { if (!cancelled) setBgHash(h); });
    return () => { cancelled = true; };
  }, [descBackground]);

  const patchBackground = (patch: Partial<BackgroundPreset>) =>
    setDescBackground(prev => ({ ...prev, ...patch }));

  const handleSaveDescSettings = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const settings: DescriptionSettings = {
      measurementPrefix: descSymbol.trim() || DEFAULT_DESCRIPTION_SETTINGS.measurementPrefix,
      washingLine: descWashing.trim(),
      closingLine: descClosing.trim(),
      includeHashtags: descHashtags,
      vendorName: descVendor.trim(),
      proseEnabled: descProseEnabled,
      proseStyle: descProseStyle.trim(),
      platformPricing: descPlatforms,
      background: descBackground,
      disclaimerLines: descDisclaimers.split('\n').map(l => l.trim()).filter(Boolean),
    };
    const res = await saveOrgDescriptionSettings(org.id, settings);
    if (res.ok) {
      setNotice('Description format saved — it applies to every listing this workspace generates from now on.');
      onDescriptionSettingsChanged?.(settings);
    } else {
      setNotice(`Save failed: ${res.error}`);
    }
    setBusy(false);
  };

  const handleResetDescSettings = () => {
    setDescSymbol(DEFAULT_DESCRIPTION_SETTINGS.measurementPrefix);
    setDescWashing(DEFAULT_DESCRIPTION_SETTINGS.washingLine);
    setDescClosing(DEFAULT_DESCRIPTION_SETTINGS.closingLine);
    setDescDisclaimers(DEFAULT_DESCRIPTION_SETTINGS.disclaimerLines.join('\n'));
    setDescHashtags(DEFAULT_DESCRIPTION_SETTINGS.includeHashtags);
    setDescVendor(DEFAULT_DESCRIPTION_SETTINGS.vendorName);
    setDescProseEnabled(DEFAULT_DESCRIPTION_SETTINGS.proseEnabled);
    setDescProseStyle(DEFAULT_DESCRIPTION_SETTINGS.proseStyle);
    // descPlatforms and descBackground are deliberately NOT reset: "reset the
    // description format" must not silently delete the workspace's marketplace
    // pricing or its photo-background recipe — two different subjects that
    // happen to share a JSONB column.
    setNotice('Reset to the default format — click Save format to apply it.');
  };

  /* ── Marketplace pricing (Feature 21) ──────────────────────────────────────
     Every mutation below rewrites the whole list rather than patching in place;
     the list is a handful of rows and nothing else holds a reference to it, so
     immutability costs nothing and removes a class of aliasing bug. Saving goes
     through handleSaveDescSettings so there is exactly one writer of this JSONB. */

  /** A new platform's id: slug of the name, suffixed only if already taken. */
  const uniquePlatformId = (name: string, existing: PlatformPricingRule[]): string => {
    const base = platformSlug(name);
    if (!existing.some(p => p.id === base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`;
      if (!existing.some(p => p.id === candidate)) return candidate;
    }
  };

  const addPlatform = (name: string, percent: number) => {
    setDescPlatforms(prev => {
      // A workspace that already has "eBay" wants to EDIT it, not collect a
      // second one — a duplicate row here is always a mis-click.
      if (prev.some(p => p.name.trim().toLowerCase() === name.trim().toLowerCase())) return prev;
      return [...prev, {
        id: uniquePlatformId(name, prev),
        name: name.trim().slice(0, 40) || 'Platform',
        enabled: true,
        adjustment: { type: 'percent' as PriceAdjustmentType, value: percent },
        rounding: 'none' as PriceRounding,
        applyToCompareAt: false,
      }];
    });
  };

  const patchPlatform = (id: string, patch: Partial<PlatformPricingRule>) =>
    setDescPlatforms(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));

  const removePlatform = (id: string) =>
    setDescPlatforms(prev => prev.filter(p => p.id !== id));

  const movePlatform = (id: string, delta: -1 | 1) =>
    setDescPlatforms(prev => {
      const i = prev.findIndex(p => p.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  /* ── Marketplaces (phase 1, docs/marketplaces/00-plan.md sections 2b + 2c) ──
     Two levels, both chosen by the seller and never inferred: the workspace
     turns a marketplace ON here, and Step 4 then picks which of those a given
     batch is aimed at. Nothing about a marketplace the workspace has not
     enabled ever appears in the workflow.

     Every write is optimistic-then-reconciled the way the rest of this panel
     is: the switch flips, the row is re-read, and a refusal puts the old value
     back with a notice — an admin-only write attempted by a member must not
     leave the UI lying about what is stored. */

  const loadMarketplaces = async () => {
    const [mk, vc] = await Promise.all([fetchOrgMarketplaces(org.id), fetchVocab(org.id)]);
    if (mk.status === 'unavailable') { setMktStatus('unavailable'); return; }
    setMktRows(mk.rows);
    // The vocabulary lives in the same migration, so one 'unavailable' is
    // enough to hide the whole tab; a vocab-only failure just leaves the list
    // empty rather than claiming the feature is missing.
    setVocabRows(vc.status === 'ok' ? vc.rows : []);
    setMktStatus('ok');
  };

  // Same shape as the reload() effect above: one fetch per workspace, no cancel
  // flag, because both reads are idempotent and StrictMode's second invocation
  // simply re-reads the same rows.
  useEffect(() => {
    loadMarketplaces();
    // loadMarketplaces is re-created every render and re-reads the same two
    // tables; listing it would refetch on every keystroke in this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  /** The stored row for a marketplace, or the "not enabled" shape. */
  const marketplaceRow = (key: MarketplaceKey): OrgMarketplaceRow =>
    mktRows.find(r => r.marketplace === key)
      ?? { org_id: org.id, marketplace: key, enabled: false, settings: {} };

  const handleToggleMarketplace = async (key: MarketplaceKey, enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await setMarketplaceEnabled(org.id, key, enabled);
    if (res.ok) {
      await loadMarketplaces();
      setNotice(enabled
        ? `${marketplaceName(key)} is on — pick it per batch in Step 4.`
        : `${marketplaceName(key)} is off. Anything already published there is kept.`);
    } else {
      setNotice(res.error);
    }
    setBusy(false);
  };

  const handleMarketplaceSetting = async (key: MarketplaceKey, patch: Partial<MarketplaceSettings>) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const next = normalizeMarketplaceSettings({ ...marketplaceRow(key).settings, ...patch });
    const res = await updateMarketplaceSettings(org.id, key, next);
    if (res.ok) await loadMarketplaces(); else setNotice(res.error);
    setBusy(false);
  };

  // ── Marketplace vocabulary ────────────────────────────────────────────────

  const visibleVocab = useMemo(() => {
    const rows = vocabRows.filter(r => (r.org_id === null ? isBetaAdmin : true));
    const filtered = vocabFilter === 'all' ? rows : rows.filter(r => r.marketplace === vocabFilter);
    // Workspace rows first — those are the ones a shop maintains and looks for;
    // the global rows below are reference. Then marketplace, kind, canonical,
    // so the list never reshuffles between renders.
    return [...filtered].sort((a, b) =>
      (a.org_id === null ? 1 : 0) - (b.org_id === null ? 1 : 0)
      || a.marketplace.localeCompare(b.marketplace)
      || a.kind.localeCompare(b.kind)
      || a.canonical.localeCompare(b.canonical, undefined, { numeric: true }));
  }, [vocabRows, vocabFilter, isBetaAdmin]);

  const enabledMarketplaceCount = useMemo(
    () => mktRows.filter(r => r.enabled).length, [mktRows]);

  /** The price rules Step 4 would offer, by id — the identity rule is always
   *  first, so "No adjustment" is a real choice and not an empty select. */
  const priceRules = useMemo(() => selectablePlatforms(descPlatforms), [descPlatforms]);

  const handleAddVocab = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await upsertVocab({
      // A global row is founder-only and RLS says so; the checkbox is only
      // rendered for a founding admin, so this can never be a silent 42501.
      orgId: vocabAdd.global && isBetaAdmin ? null : org.id,
      marketplace: vocabAdd.marketplace,
      kind: vocabAdd.kind,
      canonical: vocabAdd.canonical,
      marketplaceValue: vocabAdd.value,
    });
    if (res.ok) {
      setVocabAdd(v => ({ ...v, canonical: '', value: '' }));
      await loadMarketplaces();
      setNotice('Mapping saved.');
    } else {
      setNotice(res.error);
    }
    setBusy(false);
  };

  const handleSaveVocabEdit = async (row: VocabRow) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    // updateVocab, not upsertVocab: this edit is addressed BY ROW ID. Keyed on
    // the canonical value instead, renaming one would find nothing under the
    // new spelling and insert a second row beside the old one.
    const res = await updateVocab(row.id, vocabEditDraft.canonical, vocabEditDraft.value);
    if (res.ok) {
      setVocabEditId(null);
      await loadMarketplaces();
    } else {
      setNotice(res.error);
    }
    setBusy(false);
  };

  const handleDeleteVocab = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await deleteVocab(id);
    setConfirmKey(null);
    if (res.ok) await loadMarketplaces(); else setNotice(res.error);
    setBusy(false);
  };

  const toggleMember = (userId: string) => {
    const next = expandedMemberId === userId ? null : userId;
    setExpandedMemberId(next);
    if (next && !memberActivity[next]) {
      setMemberActivity(prev => ({ ...prev, [next]: 'loading' }));
      fetchMemberActivity(next).then(act =>
        setMemberActivity(prev => ({ ...prev, [next]: act }))
      );
    }
  };

  const reload = async (silent = false) => {
    if (!silent) setLoading(true);
    const [m, i, b, shp] = await Promise.all([
      fetchOrgMembers(org.id),
      fetchOrgInvites(org.id),
      // Still read here, and ONLY for the member-detail expand below: a founder
      // looking at this workspace's roster wants to see what that person
      // applied with. The queue itself is the Founder console's job now.
      isBetaAdmin ? fetchBetaSignups() : Promise.resolve([] as BetaSignupRow[]),
      isAdmin ? getShopifyConnection(org.id) : Promise.resolve<ShopifyConnectionStatus>({ status: 'none' }),
    ]);
    setMembers(m);
    setInvites(isAdmin ? i : []);
    setBetaSignups(b);
    setShopifyConn(shp);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  const appUrl = `${window.location.origin}${import.meta.env.BASE_URL || '/'}`;

  // ── Workspace rename ──────────────────────────────────────────────────────
  const handleRenameSave = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await renameOrganization(org.id, nameDraft);
    if (res.ok) {
      const cleaned = nameDraft.trim();
      setDisplayName(cleaned);
      setEditingName(false);
      setNotice('Workspace renamed.');
      onOrgUpdated?.({ ...org, name: cleaned });
    } else {
      setNotice(`Rename failed: ${res.error}`);
    }
    setBusy(false);
  };

  // ── Members ───────────────────────────────────────────────────────────────
  const handleRoleChange = async (m: OrgMemberRow, newRole: OrgRole) => {
    if (busy || newRole === m.role) return;
    if (m.role === 'owner' && newRole !== 'owner' && ownerCount <= 1) {
      setNotice('A workspace needs at least one owner. Make someone else an owner first.');
      return;
    }
    setBusy(true);
    setNotice(null);
    const ok = await updateMemberRole(org.id, m.user_id, newRole);
    if (!ok) {
      setNotice('Role change failed — you may not have permission.');
    } else {
      setNotice(`${m.email || 'Member'} is now ${newRole === 'owner' ? 'an owner' : newRole === 'admin' ? 'an admin' : 'a member'}.`);
      if (m.user_id === myUserId) onMyRoleChanged?.(newRole);
    }
    await reload(true);
    setBusy(false);
  };

  const handleRemove = async (userId: string) => {
    if (busy) return;
    setBusy(true);
    setConfirmKey(null);
    const ok = await removeMember(org.id, userId);
    if (!ok) setNotice('Remove failed — you may not have permission.');
    await reload(true);
    setBusy(false);
  };

  const handleLeave = async () => {
    if (busy) return;
    setBusy(true);
    setConfirmKey(null);
    const ok = await removeMember(org.id, myUserId);
    setBusy(false);
    if (ok) {
      onLeftWorkspace?.();
      onClose();
    } else {
      setNotice('Could not leave the workspace — try again.');
    }
  };

  // ── Invites ───────────────────────────────────────────────────────────────
  const handleInvite = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await inviteToOrg(org.id, inviteEmail, inviteRole);
    if (res.ok) {
      setNotice(`Invited ${inviteEmail.trim().toLowerCase()}. No email is sent automatically — use the copy button next to the invite to send them the link.`);
      setInviteEmail('');
      await reload(true);
    } else {
      setNotice(`Invite failed: ${res.error}`);
    }
    setBusy(false);
  };

  const handleRevoke = async (inviteId: string) => {
    if (busy) return;
    setBusy(true);
    await revokeInvite(inviteId);
    await reload(true);
    setBusy(false);
  };

  const handleCopyInvite = async (inv: OrgInviteRow) => {
    const msg = `You're invited to the "${displayName}" workspace on Arcadian.\n\nSign in (or create an account) at ${appUrl} using this email address: ${inv.email}\n\nYou'll join the workspace automatically.`;
    try {
      await navigator.clipboard.writeText(msg);
      setNotice('Invite message copied. Paste it into an email or text to your teammate.');
    } catch {
      setNotice(msg); // clipboard blocked — surface the text so it can be copied manually
    }
  };

  // ── Shopify connection ────────────────────────────────────────────────────
  const handleShopifySave = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await saveShopifyConnection(org.id, shopifyDomain, shopifyToken);
    if (res.ok) {
      setNotice('Shopify connected. CSV exports now check titles against this store’s catalog.');
      setShopifyToken('');
      setEditingShopify(false);
      setShopifyConn(await getShopifyConnection(org.id));
    } else {
      setNotice(`Shopify connection failed: ${res.error}`);
    }
    setBusy(false);
  };

  const handleShopifyDisconnect = async () => {
    if (busy) return;
    setBusy(true);
    setConfirmKey(null);
    const ok = await deleteShopifyConnection(org.id);
    if (ok) {
      setNotice('Shopify disconnected. Exports fall back to checking the app database only.');
      setShopifyConn({ status: 'none' });
    } else {
      setNotice('Disconnect failed — check your permissions.');
    }
    setBusy(false);
  };

  return (
    <div className="org-page">
      <div className="org-panel-header">
        <div className="org-panel-title">
          <Users size={20} />
          {editingName ? (
            <span className="org-rename-form">
              <input
                value={nameDraft}
                maxLength={60}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSave();
                  if (e.key === 'Escape') setEditingName(false);
                }}
              />
              <button className="org-icon-btn" title="Save name" disabled={busy || !nameDraft.trim()} onClick={handleRenameSave}><Check size={14} /></button>
              <button className="org-icon-btn" title="Cancel" disabled={busy} onClick={() => setEditingName(false)}><X size={14} /></button>
            </span>
          ) : (
            <>
              <h2>{displayName}</h2>
              {org.plan && org.plan !== 'free' && <span className="org-plan-badge">{org.plan}</span>}
              {isAdmin && (
                <button className="org-icon-btn" title="Rename workspace"
                  onClick={() => { setNameDraft(displayName); setEditingName(true); }}>
                  <Pencil size={13} />
                </button>
              )}
            </>
          )}
          <span className={`org-role-badge org-role-${myRole}`}>{myRole}</span>
        </div>
      </div>

      {notice && <div className="org-panel-notice">{notice}</div>}

      <div className="org-page-body">
        <nav className="org-tabs" aria-label="Workspace sections">
          <button className={`org-tab ${panelTab === 'members' ? 'org-tab--on' : ''}`} onClick={() => setPanelTab('members')}>
            Members ({members.length})
          </button>
          {isAdmin && (
            <button className={`org-tab ${panelTab === 'settings' ? 'org-tab--on' : ''}`} onClick={() => setPanelTab('settings')}>
              Settings
            </button>
          )}
          <button className={`org-tab ${panelTab === 'marketplaces' ? 'org-tab--on' : ''}`} onClick={() => setPanelTab('marketplaces')}>
            Marketplaces{mktStatus === 'ok' && enabledMarketplaceCount > 0 ? ` (${enabledMarketplaceCount})` : ''}
          </button>
        </nav>

        <div className="org-page-main">
        {isAdmin && panelTab === 'members' && (
          <div className="org-invite-form">
            <input
              type="email"
              placeholder="teammate@email.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleInvite(); }}
            />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as OrgRole)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button className="org-invite-btn" disabled={busy || !inviteEmail.trim()} onClick={handleInvite}>
              Invite
            </button>
          </div>
        )}

        {panelTab === 'members' && (loading ? (
          <p className="org-panel-loading">Loading members…</p>
        ) : (
          <>
            <h3 className="org-section-title">Members ({members.length})</h3>
            <ul className="org-member-list">
              {members.map(m => {
                const expanded = expandedMemberId === m.user_id;
                const act = memberActivity[m.user_id];
                const signup = isBetaAdmin && m.email
                  ? betaSignups.find(s => s.email.toLowerCase() === m.email!.toLowerCase())
                  : undefined;
                return (
                  <li key={m.user_id} className="org-member-row org-member-row--expandable">
                    <div className="org-member-head">
                      <button
                        className="org-member-toggle"
                        title={expanded ? 'Hide details' : 'Show details'}
                        onClick={() => toggleMember(m.user_id)}
                      >
                        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      <span className="org-member-email" role="button" onClick={() => toggleMember(m.user_id)}>
                        {m.email || m.user_id.slice(0, 8)}{m.user_id === myUserId ? ' (you)' : ''}
                        <span className="org-member-date">joined {fmtDate(m.created_at)}</span>
                      </span>
                      {isAdmin && (isOwner || m.role !== 'owner') ? (
                        <select
                          className="org-role-select"
                          value={m.role}
                          disabled={busy}
                          title="Change role"
                          onChange={(e) => handleRoleChange(m, e.target.value as OrgRole)}
                        >
                          {isOwner && <option value="owner">Owner</option>}
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                      ) : (
                        <span className={`org-role-badge org-role-${m.role}`}>{m.role}</span>
                      )}
                      {isAdmin && m.user_id !== myUserId && (
                        confirmKey === `remove:${m.user_id}` ? (
                          <span className="org-confirm-actions">
                            <button className="org-confirm-yes" disabled={busy} onClick={() => handleRemove(m.user_id)}>Confirm</button>
                            <button className="org-confirm-no" disabled={busy} onClick={() => setConfirmKey(null)}>Cancel</button>
                          </span>
                        ) : (
                          <button className="org-member-remove" disabled={busy} title="Remove from workspace"
                            onClick={() => setConfirmKey(`remove:${m.user_id}`)}>Remove</button>
                        )
                      )}
                    </div>
                    {expanded && (
                      <div className="org-member-detail">
                        {act === 'loading' || !act ? (
                          <span className="org-member-detail-loading">Loading activity…</span>
                        ) : (
                          <div className="org-member-stats">
                            <span><strong>{act.batchCount}</strong> batch{act.batchCount === 1 ? '' : 'es'} created</span>
                            <span><strong>{act.productCount}</strong> product{act.productCount === 1 ? '' : 's'} created</span>
                            <span>last active {act.lastActive ? fmtDate(act.lastActive) : 'no activity yet'}</span>
                          </div>
                        )}
                        {signup && (
                          <div className="org-member-signup">
                            Beta application: <strong>{signup.org_name}</strong> · {signup.contact_name}
                            {signup.store_url ? <> · {signup.store_url}</> : null}
                            {signup.volume ? <> · {signup.volume}/wk</> : null}
                            {signup.notes ? <> · “{signup.notes}”</> : null}
                            <span className={`org-role-badge beta-status-${signup.status}`}>{signup.status}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {isAdmin && invites.length > 0 && (
              <>
                <h3 className="org-section-title">Pending invites ({invites.length})</h3>
                <ul className="org-member-list">
                  {invites.map(inv => (
                    <li key={inv.id} className="org-member-row">
                      <span className="org-member-email">
                        {inv.email}
                        <span className="org-member-date">invited {fmtDate(inv.created_at)}</span>
                      </span>
                      <span className={`org-role-badge org-role-${inv.role}`}>{inv.role}</span>
                      <button className="org-icon-btn" title="Copy invite message to send them" disabled={busy}
                        onClick={() => handleCopyInvite(inv)}><Copy size={13} /></button>
                      <button className="org-member-remove" disabled={busy} title="Revoke invite"
                        onClick={() => handleRevoke(inv.id)}>Revoke</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ))}

        {panelTab === 'settings' && isAdmin && !loading && shopifyConn && shopifyConn.status !== 'unavailable' && (
          <>
            <h3 className="org-section-title">Shopify connection</h3>
            {shopifyConn.status === 'connected' && !editingShopify ? (
              <div className="shopify-conn-row">
                <span className="org-member-email">
                  <ShoppingBag size={13} /> <strong>{shopifyConn.info.store_domain}</strong>
                  <span className="org-member-date">
                    connected {fmtDate(shopifyConn.info.updated_at)} · token stored server side, never shown again
                  </span>
                </span>
                <button className="org-icon-btn" title="Replace store or token" disabled={busy}
                  onClick={() => {
                    setShopifyDomain(shopifyConn.info.store_domain);
                    setShopifyToken('');
                    setEditingShopify(true);
                  }}><Pencil size={13} /></button>
                {confirmKey === 'shopify-disconnect' ? (
                  <span className="org-confirm-actions">
                    <button className="org-confirm-yes" disabled={busy} onClick={handleShopifyDisconnect}>Disconnect</button>
                    <button className="org-confirm-no" disabled={busy} onClick={() => setConfirmKey(null)}>Cancel</button>
                  </span>
                ) : (
                  <button className="org-member-remove" disabled={busy} title="Disconnect this store"
                    onClick={() => setConfirmKey('shopify-disconnect')}>Disconnect</button>
                )}
              </div>
            ) : (
              <div className="shopify-conn-form">
                <p className="shopify-conn-help">
                  Connect your store so CSV exports check for title collisions against your own catalog
                  and carry your store’s color, fabric, and gender metafield ids.
                  In Shopify: Settings → Apps and sales channels → Develop apps → create an app with the
                  <strong> read_products</strong> and <strong>read_metaobjects</strong> scopes, then paste
                  the Admin API token here. The token is stored server side and can never be read back
                  from the browser.
                </p>
                <div className="org-invite-form">
                  <input
                    placeholder="my-store.myshopify.com"
                    value={shopifyDomain}
                    onChange={(e) => setShopifyDomain(e.target.value)}
                  />
                  <input
                    type="password"
                    placeholder="shpat_…"
                    autoComplete="off"
                    value={shopifyToken}
                    onChange={(e) => setShopifyToken(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleShopifySave(); }}
                  />
                  <button className="org-invite-btn" disabled={busy || !shopifyDomain.trim() || !shopifyToken.trim()}
                    onClick={handleShopifySave}>Connect</button>
                  {editingShopify && (
                    <button className="org-confirm-no" disabled={busy} onClick={() => setEditingShopify(false)}>Cancel</button>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {panelTab === 'settings' && isAdmin && !loading && descLoaded && (
          <>
            <h3 className="org-section-title">Listing description format</h3>
            <p className="shopify-conn-help">
              How generated descriptions read for everyone in this workspace.
              Leave a line empty to leave it out of your descriptions.
            </p>
            <div className="desc-settings-form">
              <label className="desc-settings-field">
                <span>Vendor name (Shopify CSV Vendor column — your shop, not the garment brand)</span>
                <input value={descVendor} placeholder={org.name}
                  onChange={(e) => setDescVendor(e.target.value)} />
              </label>
              <label className="desc-settings-field desc-settings-field--narrow">
                <span>Measurement symbol</span>
                <input value={descSymbol} maxLength={4}
                  onChange={(e) => setDescSymbol(e.target.value)} />
              </label>
              <label className="desc-settings-field">
                <span>Garment prep line</span>
                <input value={descWashing} placeholder="e.g. All items washed before shipping"
                  onChange={(e) => setDescWashing(e.target.value)} />
              </label>
              <label className="desc-settings-field">
                <span>Closing line</span>
                <input value={descClosing} placeholder="e.g. BUNDLE AND SAVE"
                  onChange={(e) => setDescClosing(e.target.value)} />
              </label>
              <label className="desc-settings-field">
                <span>Closing disclaimers (one per line)</span>
                <textarea rows={4} value={descDisclaimers}
                  onChange={(e) => setDescDisclaimers(e.target.value)} />
              </label>
              <label className="desc-settings-check">
                <input type="checkbox" checked={descHashtags}
                  onChange={(e) => setDescHashtags(e.target.checked)} />
                Include #hashtags at the end
              </label>
              <label className="desc-settings-check">
                <input type="checkbox" checked={descProseEnabled}
                  onChange={(e) => setDescProseEnabled(e.target.checked)} />
                Write a selling paragraph automatically (language model, checked before use;
                falls back to the plain keyword note if unavailable)
              </label>
              {descProseEnabled && (
                <label className="desc-settings-field">
                  <span>Selling paragraph voice (style notes for the writer)</span>
                  <textarea rows={2} value={descProseStyle}
                    placeholder="e.g. Punchy streetwear voice, short sentences, no fluff"
                    onChange={(e) => setDescProseStyle(e.target.value)} />
                </label>
              )}
              <div className="desc-settings-actions">
                <button className="org-invite-btn" disabled={busy} onClick={handleSaveDescSettings}>Save format</button>
                <button className="org-confirm-no" disabled={busy} onClick={handleResetDescSettings}>Reset to defaults</button>
              </div>
            </div>

            {/* ── Marketplace pricing (Feature 21) ──────────────────────────
                The listing keeps one price; each marketplace here is a rule
                applied at CSV export time, chosen in Step 4. Nothing is
                written back to a listing, so adding a platform can never
                change what anyone sees in Step 3. */}
            <h3 className="org-section-title"><Tags size={15} aria-hidden="true" /> Marketplace pricing</h3>
            <p className="shopify-conn-help">
              Each marketplace takes its own cut, so the same garment needs a different
              number on each one. Set the markup once here and pick the marketplace in
              Step 4 — the listing's own price never changes.
            </p>

            <div className="plat-list">
              {descPlatforms.length === 0 && (
                <p className="org-panel-loading">
                  No marketplaces yet. Add one below — until you do, Step 4 exports your
                  prices exactly as they are.
                </p>
              )}

              {descPlatforms.map((pf, idx) => (
                <div className={`plat-row${pf.enabled ? '' : ' plat-row--off'}`} key={pf.id}>
                  <div className="plat-row-main">
                    <label className="plat-field plat-field--name">
                      <span>Marketplace</span>
                      <input
                        value={pf.name}
                        maxLength={40}
                        onChange={(e) => patchPlatform(pf.id, { name: e.target.value })}
                      />
                    </label>

                    <label className="plat-field plat-field--narrow">
                      <span>Adjust by</span>
                      <select
                        value={pf.adjustment.type}
                        onChange={(e) => patchPlatform(pf.id, {
                          adjustment: { ...pf.adjustment, type: e.target.value as PriceAdjustmentType },
                        })}
                      >
                        {ADJUSTMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </label>

                    <label className="plat-field plat-field--narrow">
                      <span>{pf.adjustment.type === 'percent' ? 'Percent' : 'Dollars'}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step={pf.adjustment.type === 'percent' ? 0.5 : 0.25}
                        min={pf.adjustment.type === 'percent' ? -MAX_PERCENT : -MAX_FIXED}
                        max={pf.adjustment.type === 'percent' ? MAX_PERCENT : MAX_FIXED}
                        value={String(pf.adjustment.value)}
                        onChange={(e) => {
                          // Keep an in-progress "-" or "" from becoming NaN and
                          // wiping the field while the user is still typing.
                          const n = parseFloat(e.target.value);
                          patchPlatform(pf.id, {
                            adjustment: { ...pf.adjustment, value: Number.isFinite(n) ? n : 0 },
                          });
                        }}
                      />
                    </label>

                    <label className="plat-field plat-field--narrow">
                      <span>Round</span>
                      <select
                        value={pf.rounding}
                        onChange={(e) => patchPlatform(pf.id, { rounding: e.target.value as PriceRounding })}
                      >
                        {ROUNDING_MODES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </label>
                  </div>

                  <div className="plat-row-foot">
                    {/* The worked example is the whole point of the row: nobody
                        reasons about "+13% rounded to .99" in the abstract. */}
                    <span className="plat-example" aria-live="polite">{pricingExample(pf)}</span>

                    <label className="plat-check">
                      <input
                        type="checkbox"
                        checked={pf.applyToCompareAt}
                        onChange={(e) => patchPlatform(pf.id, { applyToCompareAt: e.target.checked })}
                      />
                      Compare-at too
                    </label>

                    <label className="plat-check">
                      <input
                        type="checkbox"
                        checked={pf.enabled}
                        onChange={(e) => patchPlatform(pf.id, { enabled: e.target.checked })}
                      />
                      Show in Step 4
                    </label>

                    <div className="plat-row-actions">
                      <button
                        type="button" className="plat-icon-btn"
                        onClick={() => movePlatform(pf.id, -1)} disabled={idx === 0}
                        title="Move up" aria-label={`Move ${pf.name} up`}
                      ><ArrowUp size={14} /></button>
                      <button
                        type="button" className="plat-icon-btn"
                        onClick={() => movePlatform(pf.id, 1)} disabled={idx === descPlatforms.length - 1}
                        title="Move down" aria-label={`Move ${pf.name} down`}
                      ><ArrowDown size={14} /></button>
                      <button
                        type="button" className="plat-icon-btn plat-icon-btn--danger"
                        onClick={() => removePlatform(pf.id)}
                        title="Remove" aria-label={`Remove ${pf.name}`}
                      ><Trash2 size={14} /></button>
                    </div>
                  </div>

                  <p className="plat-summary">{describePlatformRule(pf)}</p>
                </div>
              ))}
            </div>

            <div className="plat-add">
              <span className="plat-add-label"><Plus size={13} aria-hidden="true" /> Add a marketplace</span>
              <div className="plat-add-chips">
                {PLATFORM_PRESETS.map(preset => {
                  const already = descPlatforms.some(
                    p => p.name.trim().toLowerCase() === preset.name.toLowerCase());
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      className="plat-add-chip"
                      disabled={already}
                      onClick={() => addPlatform(preset.name, preset.percent)}
                    >
                      {preset.name}{preset.percent ? ` +${preset.percent}%` : ''}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="plat-add-chip plat-add-chip--custom"
                  onClick={() => addPlatform(`Marketplace ${descPlatforms.length + 1}`, 0)}
                >
                  Custom…
                </button>
              </div>
              <p className="shopify-conn-help">
                The suggested percentages are each marketplace's published headline fee as a
                starting point, not advice — fees change, so check yours and edit the number.
              </p>
            </div>

            <div className="desc-settings-actions">
              <button className="org-invite-btn" disabled={busy} onClick={handleSaveDescSettings}>
                Save marketplaces
              </button>
            </div>

            {/* ── Photo backgrounds ─────────────────────────────────────────
                One recipe for the whole workspace. The matting service cuts the
                garment out and pastes it onto this flat colour at this size;
                nothing here is generative. Changing it does NOT touch photos
                already processed — a composite keeps the preset hash it was
                built with, which is how Step 2 can offer to re-run rather than
                silently reprocessing a batch behind the seller's back. */}
            <h3 className="org-section-title"><ImageIcon size={15} aria-hidden="true" /> Photo backgrounds</h3>
            <p className="shopify-conn-help">
              Cut each garment out of its photo and put it on a plain backdrop, the same
              way every time. Changing this only affects photos processed from now on —
              re-run a batch from Step 2 to apply it to older photos.
            </p>

            <div className="bg-settings">
              <div className="bg-preview-col">
                <canvas
                  ref={bgCanvasRef}
                  className="bg-preview"
                  width={BG_PREVIEW_PX}
                  height={BG_PREVIEW_PX}
                  role="img"
                  aria-label={`Preview: ${descBackground.canvas}px square, ${normalizeBackgroundColor(descBackground.color)} backdrop, ${Math.round(descBackground.padding * 100)}% margin, ${descBackground.anchor === 'top' ? 'hanging from the top' : 'centered'}${descBackground.shadow ? ', with a shadow' : ''}`}
                />
                <p className="bg-preview-meta">
                  {descBackground.canvas} × {descBackground.canvas} px · JPEG {descBackground.quality}
                  {bgHash && <> · preset <code>{bgHash}</code></>}
                </p>
              </div>

              <div className="bg-controls">
                <div className="bg-field">
                  <span className="bg-label">Backdrop</span>
                  <div className="bg-swatches">
                    {BACKGROUND_COLORS.map(c => {
                      const on = normalizeBackgroundColor(descBackground.color) === c.hex;
                      return (
                        <button
                          key={c.hex}
                          type="button"
                          className={`bg-swatch${on ? ' bg-swatch--on' : ''}`}
                          style={{ background: c.hex }}
                          aria-pressed={on}
                          title={`${c.label} (${c.hex})`}
                          onClick={() => patchBackground({ color: c.hex })}
                        >
                          <span className="ui-sr-only">{c.label}</span>
                          {on && <Check size={13} aria-hidden="true" />}
                        </button>
                      );
                    })}
                    <input
                      className="bg-hex"
                      value={descBackground.color}
                      maxLength={7}
                      spellCheck={false}
                      aria-label="Backdrop colour, as a hex value"
                      onChange={(e) => patchBackground({ color: e.target.value })}
                      onBlur={(e) => patchBackground({ color: normalizeBackgroundColor(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="bg-field">
                  <span className="bg-label">Margin — {Math.round(descBackground.padding * 100)}%</span>
                  <input
                    type="range"
                    min={0}
                    max={Math.round(BACKGROUND_PADDING_MAX * 100)}
                    step={1}
                    value={Math.round(descBackground.padding * 100)}
                    aria-label="Margin around the garment, as a percentage of the canvas"
                    onChange={(e) => patchBackground({ padding: Number(e.target.value) / 100 })}
                  />
                </div>

                <div className="bg-field bg-field--row">
                  <label className="bg-inline">
                    <span className="bg-label">Position</span>
                    <select
                      value={descBackground.anchor}
                      onChange={(e) => patchBackground({ anchor: e.target.value as BackgroundAnchor })}
                    >
                      <option value="center">Centered</option>
                      <option value="top">Hanging from top</option>
                    </select>
                  </label>

                  <label className="bg-inline">
                    <span className="bg-label">Canvas</span>
                    <select
                      value={String(descBackground.canvas)}
                      onChange={(e) => patchBackground({ canvas: Number(e.target.value) })}
                    >
                      <option value="1024">1024 px</option>
                      <option value="1536">1536 px</option>
                      <option value="2048">2048 px (recommended)</option>
                      <option value="2560">2560 px</option>
                    </select>
                  </label>
                </div>

                <div className="bg-field">
                  <span className="bg-label">Quality — {descBackground.quality}</span>
                  <input
                    type="range"
                    min={BACKGROUND_QUALITY_MIN}
                    max={BACKGROUND_QUALITY_MAX}
                    step={1}
                    value={descBackground.quality}
                    aria-label="JPEG quality of the composite"
                    onChange={(e) => patchBackground({ quality: Number(e.target.value) })}
                  />
                </div>

                <label className="plat-check">
                  <input
                    type="checkbox"
                    checked={descBackground.shadow}
                    onChange={(e) => patchBackground({ shadow: e.target.checked })}
                  />
                  Add a soft shadow under the garment
                </label>
                <p className="shopify-conn-help bg-note">
                  Several marketplaces reject anything but a plain, even backdrop — leave the
                  shadow off unless you know yours allows one.
                </p>
              </div>
            </div>

            <div className="desc-settings-actions">
              <button className="org-invite-btn" disabled={busy} onClick={handleSaveDescSettings}>
                Save backgrounds
              </button>
              <button
                className="org-confirm-no"
                disabled={busy}
                onClick={() => setDescBackground({ ...DEFAULT_BACKGROUND_PRESET })}
              >
                Reset to white
              </button>
            </div>
          </>
        )}

        {/* ── Marketplaces ────────────────────────────────────────────────
            Where this workspace sells (admins), and what each marketplace
            calls a brand / colour / condition / size / category (any member —
            plus the global rows, for founding admins). */}
        {panelTab === 'marketplaces' && mktStatus === 'loading' && (
          <p className="org-panel-loading">Loading marketplaces…</p>
        )}

        {panelTab === 'marketplaces' && mktStatus === 'unavailable' && (
          <p className="ft-setup">
            Marketplaces are not set up yet — run <code>supabase/migrations/marketplaces.sql</code> in
            the SQL Editor. Until then nothing changes: Step 4 exports the Shopify CSV exactly as it
            does today. Once the tables exist, this is where you choose which marketplaces you sell
            on and teach the app what each one calls your brands, colours and sizes.
          </p>
        )}

        {panelTab === 'marketplaces' && mktStatus === 'ok' && (
          <>
            <h3 className="org-section-title"><Store size={15} aria-hidden="true" /> Where you sell</h3>
            <p className="shopify-conn-help">
              Turn on the marketplaces this shop actually lists on. Only these are offered when you
              pick a batch's targets in Step 4 — nothing you have not turned on ever appears in the
              workflow. Turning one off later keeps every record of what you already published there.
              {!isAdmin && ' Only a workspace admin can change these.'}
            </p>

            <div className="plat-list">
              {MARKETPLACE_KEYS.map(key => {
                const row = marketplaceRow(key);
                return (
                  <div className={`plat-row${row.enabled ? '' : ' plat-row--off'}`} key={key}>
                    <div className="mkt-row-head">
                      <label className="plat-check mkt-switch">
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          disabled={busy || !isAdmin}
                          onChange={(e) => handleToggleMarketplace(key, e.target.checked)}
                        />
                        <span className="mkt-name">{marketplaceName(key)}</span>
                      </label>
                      {row.enabled && <span className="mkt-on-badge">On</span>}
                    </div>

                    {row.enabled && (
                      <div className="plat-row-main">
                        <label className="plat-field">
                          <span>Price rule</span>
                          <select
                            value={row.settings.pricingRuleId ?? ''}
                            disabled={busy || !isAdmin}
                            onChange={(e) => handleMarketplaceSetting(key, { pricingRuleId: e.target.value })}
                          >
                            <option value="">No adjustment — list price</option>
                            {priceRules.map(r => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                        </label>

                        <label className="plat-field">
                          <span>Default condition</span>
                          <select
                            value={row.settings.defaultCondition ?? ''}
                            disabled={busy || !isAdmin}
                            onChange={(e) => handleMarketplaceSetting(key, { defaultCondition: e.target.value })}
                          >
                            <option value="">None — ask per listing</option>
                            {CONDITION_GRADES.map(g => (
                              <option key={g} value={g}>{g.replace(/_/g, ' ')}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}

                    {row.enabled && row.settings.pricingRuleId
                      && !priceRules.some(r => r.id === row.settings.pricingRuleId) && (
                      /* The rule was renamed or removed in Settings. Say so
                         rather than silently applying no adjustment — that is
                         the export price, and a quiet fallback is how a listing
                         goes out at the wrong number. */
                      <p className="plat-summary mkt-warn">
                        This marketplace points at a price rule that no longer exists
                        (<code>{row.settings.pricingRuleId}</code>) — it will export at the list
                        price until you pick another.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Marketplace vocabulary ──────────────────────────────────── */}
            <h3 className="org-section-title"><Tags size={15} aria-hidden="true" /> Marketplace vocabulary</h3>
            <p className="shopify-conn-help">
              Poshmark, Depop, Grailed, Vinted and Mercari pick a brand and a colour from their own
              list. If we send a spelling they do not know, they either reject the field or quietly
              choose one for you. Teach them here once and every listing goes out right.
              {isBetaAdmin
                ? ' You can edit the shared rows every workspace sees, as well as this shop’s own.'
                : ' Anyone on the team can add one.'}
            </p>

            <div className="mkt-vocab-filter">
              <label className="plat-field plat-field--narrow">
                <span>Marketplace</span>
                <select value={vocabFilter} onChange={(e) => setVocabFilter(e.target.value as 'all' | MarketplaceKey)}>
                  <option value="all">All marketplaces</option>
                  {MARKETPLACE_KEYS.map(k => <option key={k} value={k}>{marketplaceName(k)}</option>)}
                </select>
              </label>
              <span className="plat-summary">{visibleVocab.length} mapping{visibleVocab.length === 1 ? '' : 's'}</span>
            </div>

            {visibleVocab.length === 0 ? (
              <p className="org-panel-loading">
                No mappings yet{vocabFilter === 'all' ? '' : ` for ${marketplaceName(vocabFilter)}`}. Add one below.
              </p>
            ) : (
              <ul className="mkt-vocab-list">
                {visibleVocab.map(row => (
                  <li className="mkt-vocab-row" key={row.id}>
                    <div className="mkt-vocab-meta">
                      <span className="mkt-vocab-where">{marketplaceName(row.marketplace)}</span>
                      <span className="mkt-vocab-kind">{VOCAB_KIND_LABELS[row.kind]}</span>
                      <span className={`mkt-scope${row.org_id === null ? ' mkt-scope--global' : ''}`}>
                        {row.org_id === null
                          ? <><Globe size={11} aria-hidden="true" /> all workspaces</>
                          : 'this workspace only'}
                      </span>
                    </div>

                    {vocabEditId === row.id ? (
                      <div className="mkt-vocab-edit">
                        <input
                          value={vocabEditDraft.canonical}
                          aria-label="What the app holds"
                          onChange={(e) => setVocabEditDraft(d => ({ ...d, canonical: e.target.value }))}
                        />
                        <span className="mkt-arrow" aria-hidden="true">→</span>
                        <input
                          value={vocabEditDraft.value}
                          aria-label={`What ${marketplaceName(row.marketplace)} calls it`}
                          onChange={(e) => setVocabEditDraft(d => ({ ...d, value: e.target.value }))}
                        />
                        <button className="org-icon-btn" title="Save mapping" disabled={busy}
                          onClick={() => handleSaveVocabEdit(row)}><Check size={13} /></button>
                        <button className="org-icon-btn" title="Cancel" disabled={busy}
                          onClick={() => setVocabEditId(null)}><X size={13} /></button>
                      </div>
                    ) : (
                      <div className="mkt-vocab-pair">
                        <span className="mkt-vocab-canonical">{row.canonical}</span>
                        <span className="mkt-arrow" aria-hidden="true">→</span>
                        <span className="mkt-vocab-value">{row.marketplace_value}</span>
                        <span className="mkt-vocab-actions">
                          <button className="org-icon-btn" title="Edit mapping" disabled={busy}
                            onClick={() => {
                              setVocabEditId(row.id);
                              setVocabEditDraft({ canonical: row.canonical, value: row.marketplace_value });
                            }}><Pencil size={13} /></button>
                          {confirmKey === `mkt-vocab:${row.id}` ? (
                            <span className="org-confirm-actions">
                              <button className="org-confirm-yes" disabled={busy}
                                onClick={() => handleDeleteVocab(row.id)}>Delete</button>
                              <button className="org-confirm-no" disabled={busy}
                                onClick={() => setConfirmKey(null)}>Cancel</button>
                            </span>
                          ) : (
                            <button className="org-icon-btn org-icon-danger" title="Delete mapping" disabled={busy}
                              onClick={() => setConfirmKey(`mkt-vocab:${row.id}`)}><Trash2 size={13} /></button>
                          )}
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="plat-add">
              <span className="plat-add-label"><Plus size={13} aria-hidden="true" /> Add a mapping</span>
              <div className="mkt-vocab-add">
                <label className="plat-field plat-field--narrow">
                  <span>Marketplace</span>
                  <select value={vocabAdd.marketplace}
                    onChange={(e) => setVocabAdd(v => ({ ...v, marketplace: e.target.value as MarketplaceKey }))}>
                    {MARKETPLACE_KEYS.map(k => <option key={k} value={k}>{marketplaceName(k)}</option>)}
                  </select>
                </label>
                <label className="plat-field plat-field--narrow">
                  <span>Field</span>
                  <select value={vocabAdd.kind}
                    onChange={(e) => setVocabAdd(v => ({ ...v, kind: e.target.value as VocabKind }))}>
                    {VOCAB_KINDS.map(k => <option key={k} value={k}>{VOCAB_KIND_LABELS[k]}</option>)}
                  </select>
                </label>
                <label className="plat-field">
                  <span>What we hold</span>
                  <input value={vocabAdd.canonical} maxLength={120} placeholder="Ecko Unltd"
                    onChange={(e) => setVocabAdd(v => ({ ...v, canonical: e.target.value }))} />
                </label>
                <label className="plat-field">
                  <span>What {marketplaceName(vocabAdd.marketplace)} calls it</span>
                  <input value={vocabAdd.value} maxLength={120} placeholder="Ecko Unlimited"
                    onChange={(e) => setVocabAdd(v => ({ ...v, value: e.target.value }))} />
                </label>
              </div>
              {isBetaAdmin && (
                <label className="plat-check">
                  <input type="checkbox" checked={vocabAdd.global}
                    onChange={(e) => setVocabAdd(v => ({ ...v, global: e.target.checked }))} />
                  Shared with every workspace (a founder row — a shop can still override it)
                </label>
              )}
              <div className="desc-settings-actions">
                <button className="org-invite-btn" disabled={busy || !vocabAdd.canonical.trim() || !vocabAdd.value.trim()}
                  onClick={handleAddVocab}>Save mapping</button>
              </div>
            </div>
          </>
        )}

        {/* The three cross-workspace sections that used to be tabs here —
            beta requests, the workspace directory and every account — moved to
            the Founder console (Sept 2026). This page is about the workspace
            you are IN; those are about the ones you are not. One link, not a
            second copy: two places to approve a shop is one place too many. */}
        {isBetaAdmin && panelTab === 'members' && onOpenFounder && (
          <div className="org-founder-link">
            <h3 className="org-section-title"><ShieldCheck size={13} /> Running the beta</h3>
            <p className="shopify-conn-help">
              Beta requests, every workspace and every account are managed in the
              Founder console.
            </p>
            <button className="org-invite-btn" onClick={onOpenFounder}>
              Open the Founder console
            </button>
          </div>
        )}

        {panelTab === 'members' && !loading && canLeave && (
          <div className="org-leave-section">
            {confirmKey === 'leave' ? (
              <span className="org-confirm-actions">
                <span className="org-leave-warning">You'll lose access to everything in this workspace.</span>
                <button className="org-confirm-yes" disabled={busy} onClick={handleLeave}>Leave workspace</button>
                <button className="org-confirm-no" disabled={busy} onClick={() => setConfirmKey(null)}>Cancel</button>
              </span>
            ) : (
              <button className="org-leave-btn" disabled={busy} onClick={() => setConfirmKey('leave')}>
                <LogOut size={13} /> Leave this workspace
              </button>
            )}
          </div>
        )}

        <p className="org-panel-footnote">
          Everyone in this workspace shares its batches, products, categories, and presets.
          People outside it can't see any of them.
        </p>
        </div>
      </div>
    </div>
  );
}
