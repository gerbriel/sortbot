import { forwardRef, useImperativeHandle, useEffect, useMemo, useState, memo } from 'react';
import { Ban, FileText, CheckCircle2, Tags } from 'lucide-react';
import type { ClothingItem } from '../App';
import { supabase } from '../lib/supabase';
import { publicImageUrl } from '../lib/storageUrls';
import { smartSeoTruncate } from '../lib/textAIService';
import { track } from '../lib/analytics';
import {
  baseSize, stripUnresolvedTokens, buildCleanTitle, buildShopifyCsv,
  resolveCategoryPath, resolveProductType, canonicalTaxonomyPath,
  resolveColorGid, resolveFabricGid, resolveGenderGid,
  type GidOverrides,
} from '../lib/csvExport';
import {
  selectablePlatforms, describePlatformRule, platformSlug, isIdentityRule,
  formatPlatformPrice, applyPlatformPrice, toPriceNumber,
  type PlatformPricingRule,
} from '../lib/platformPricing';
import { getOrgDescriptionSettings } from '../lib/descriptionSettings';
import './GoogleSheetExporter.css';

/**
 * Returns a full https:// Supabase public URL for an item, or '' if unavailable.
 * Rejects blob: URLs because Shopify can't fetch those.
 */
function resolvePublicUrl(item: ClothingItem): string {
  // imageUrls[0] is the authoritative full-res URL — use it if it's a real https URL
  const candidate = item.imageUrls?.[0] || '';
  if (candidate.startsWith('https://')) return candidate;

  // Fall back to reconstructing from storagePath
  if (item.storagePath) {
    return publicImageUrl(item.storagePath);
  }

  // preview may be a blob URL (in-session before page reload) — reject it
  const preview = item.preview || '';
  if (preview.startsWith('https://')) return preview;

  return '';
}

interface GoogleSheetExporterProps {
  items: ClothingItem[];
  compactMode?: boolean;
  /** Seller name for the CSV Vendor column (workspace/reseller, e.g.
   *  "C&D Vintage") — NOT the garment's brand. Empty → falls back to brand. */
  vendorName?: string;
  /** The workspace's configured marketplaces (description_settings.
   *  platformPricing). Undefined means "App has not resolved settings yet" —
   *  distinct from [], which means "this workspace has configured none". */
  platformPricing?: PlatformPricingRule[];
  /** Fallback source for the above: when `platformPricing` is not supplied but
   *  an org id is, the settings are fetched here. Lets the exporter work in
   *  any mount that has an org without threading settings through it. */
  orgId?: string;
}

export interface GoogleSheetExporterHandle {
  downloadCSV: () => void;
}

const GoogleSheetExporter = forwardRef<GoogleSheetExporterHandle, GoogleSheetExporterProps>(
  ({ items, compactMode = false, vendorName, platformPricing, orgId }, ref) => {

  // Titles of products that ALREADY exist in the DB from OTHER batches (a proxy for
  // "already uploaded to Shopify"). Used to suffix this export's titles/handles so a new
  // upload never collides with an existing product. Excludes the current batch's own items
  // so re-exporting the same batch keeps identical titles (Shopify updates, not duplicates).
  const [existingTitles, setExistingTitles] = useState<Set<string>>(new Set());
  // Per-store metaobject GID maps (color/fabric/gender) from the workspace's
  // connected Shopify store. null → the hardcoded founding-store maps apply.
  const [gidOverrides, setGidOverrides] = useState<GidOverrides | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Current batch's product ids + group ids — these must NOT count as "existing".
      const ownKeys = new Set<string>();
      for (const i of items) { ownKeys.add(i.id); if (i.productGroup) ownKeys.add(i.productGroup); }
      // Current batch's own titles — excluded from the Shopify set so re-exporting a batch
      // that was already uploaded keeps identical titles (Shopify updates, not duplicates).
      const ownTitles = new Set<string>();
      for (const i of items) { const t = (i.seoTitle || '').trim().toLowerCase(); if (t) ownTitles.add(t); }

      const titles = new Set<string>();

      // Source 1 — app's own products table (paginated; PostgREST caps at 1000 rows).
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('products')
          .select('seo_title, id, product_group')
          .not('seo_title', 'is', null)
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        for (const r of data as Array<{ seo_title: string | null; id: string; product_group: string | null }>) {
          if (ownKeys.has(r.id) || (r.product_group && ownKeys.has(r.product_group))) continue;
          const t = (r.seo_title || '').trim().toLowerCase();
          if (t) titles.add(t);
        }
        if (data.length < PAGE) break;
      }

      // Source 2 — live Shopify catalog via the shopify-titles Edge Function. Best-effort:
      // if the function isn't deployed or errors, we silently fall back to Source 1 only.
      try {
        const { data: sh, error: shErr } = await supabase.functions.invoke('shopify-titles');
        if (!shErr && sh && Array.isArray(sh.titles)) {
          for (const raw of sh.titles as string[]) {
            const t = (raw || '').trim().toLowerCase();
            if (t && !ownTitles.has(t)) titles.add(t);
          }
        }
        // Per-store metaobject GID maps — when present, they replace the
        // hardcoded founding-store maps so this store's CSV carries GIDs that
        // actually resolve in ITS catalog (metaobject ids are store-specific).
        if (!shErr && sh && typeof sh.metaobjects === 'object' && sh.metaobjects && !cancelled) {
          const mo = sh.metaobjects as GidOverrides;
          if (mo.color || mo.fabric || mo.gender) setGidOverrides(mo);
        }
      } catch { /* Shopify read unavailable — DB cross-reference still applies */ }

      if (!cancelled) setExistingTitles(titles);
    })();
    return () => { cancelled = true; };
    // Re-fetch only when the SET of items changes (not on every field keystroke).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  /* ── Per-platform pricing (Feature 21) ───────────────────────────────────
     The listing keeps ONE price; a platform is a function applied here, at
     export time. Nothing is written back to the database, so the same batch
     exports to Shopify and to eBay from the same rows and the price the user
     typed in Step 3 never becomes ambiguous. See src/lib/platformPricing.ts. */
  const [fetchedRules, setFetchedRules] = useState<PlatformPricingRule[] | null>(null);
  useEffect(() => {
    // Only when App did not hand the settings down. `platformPricing` being an
    // empty array is an ANSWER ("none configured"), not a reason to go and ask.
    if (platformPricing || !orgId) return;
    let cancelled = false;
    getOrgDescriptionSettings(orgId).then(s => {
      if (!cancelled) setFetchedRules(s.platformPricing);
    });
    return () => { cancelled = true; };
  }, [platformPricing, orgId]);

  const platforms = useMemo(
    () => selectablePlatforms(platformPricing ?? fetchedRules),
    [platformPricing, fetchedRules],
  );
  const [platformId, setPlatformId] = useState<string>(platforms[0].id);
  /* Derive rather than store: if the workspace disables or renames the selected
     platform while Step 4 is open, a stored id would silently keep applying a
     rule that no longer exists. Falling back to the first platform (always the
     no-adjustment one) is the safe direction — it under-charges nobody. */
  const platform = platforms.find(p => p.id === platformId) ?? platforms[0];
  const pricingRule = isIdentityRule(platform) ? null : platform;
  const pricingSummary = describePlatformRule(platform);

  // Group items by productGroup - each group is ONE product
  const productGroups = items.reduce((groups, item) => {
    const groupId = item.productGroup || item.id; // If no group, item becomes its own product
    if (!groups[groupId]) {
      groups[groupId] = [];
    }
    groups[groupId].push(item);
    return groups;
  }, {} as Record<string, ClothingItem[]>);

  // Order the CSV rows by when the photos were taken (earliest capturedAt of each
  // group's members), matching Step 2's default ↑ Date sort — so products land in
  // Shopify in shoot/grouping order instead of the scrambled processedItems order
  // (which drifts across merges, gap-fills, and restores during a session).
  // Tiebreak: original filename in natural order (DSC02175 < DSC02176), same as
  // the Step 2 name sort. Items WITHIN a group keep their existing order so the
  // primary image (position 0) is never changed by the export.
  const groupCaptureKey = (group: ClothingItem[]): number => {
    const times = group
      .map(i => i.capturedAt)
      .filter((t): t is number => typeof t === 'number' && t > 0);
    return times.length ? Math.min(...times) : Number.MAX_SAFE_INTEGER;
  };
  const orderedGroups = Object.values(productGroups).sort((a, b) => {
    const ka = groupCaptureKey(a);
    const kb = groupCaptureKey(b);
    if (ka !== kb) return ka - kb;
    const na = a[0]?.originalName || a[0]?.storagePath || '';
    const nb = b[0]?.originalName || b[0]?.storagePath || '';
    return na.localeCompare(nb, undefined, { numeric: true });
  });

  // Build products, then deduplicate titles/handles in a second pass
  const rawProducts = orderedGroups.map(group => {
    // Coalesce fields across the WHOLE group so the exported product never depends on
    // which item happens to be group[0]. For each field, take the first member that has a
    // non-empty value. This fixes price / brand / size / condition / measurements showing
    // blank or stale values when the representative item was missing data another member had.
    const isBlank = (v: unknown) =>
      v === undefined || v === null || v === '' ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);
    const productData = group.reduce((acc, it) => {
      const a = acc as unknown as Record<string, unknown>;
      const i = it as unknown as Record<string, unknown>;
      for (const k in i) {
        if (isBlank(a[k]) && !isBlank(i[k])) a[k] = i[k];
      }
      return acc;
    }, { ...group[0] } as ClothingItem);

    // Find the best seoTitle from any item in the group:
    // prefer a real title (no unresolved {tokens}) over a raw template
    const resolvedTitle = group
      .map(item => item.seoTitle || '')
      .find(t => t.trim() && !/\{[a-z_]+\}/i.test(t));

    // If no real title exists, build one from filled fields
    const autoTitle = (() => {
      const src = group.find(i => i.brand || i.color || i.category || i.modelName) || productData;
      const parts: string[] = [];
      if (src.brand) parts.push(src.brand);
      if (src.modelName) parts.push(src.modelName);
      if (src.color) parts.push(src.color);
      if (src.category) parts.push(src.category);
      if (src.size) parts.push(`(${baseSize(src.size)})`);
      const built = parts.filter(Boolean).join(' ');
      // If we have nothing distinctive, fall back to the filename (minus extension)
      // so every product gets a unique title/handle even without AI-generated data.
      if (!built) {
        const nameSource = group.find(i => i.originalName) || productData;
        const filename = (nameSource.originalName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        return filename || '';
      }
      return built;
    })();

    // Strip any remaining {tokens} from whichever title we use
    const bestTitle = stripUnresolvedTokens(resolvedTitle || autoTitle || productData.seoTitle || '');

    return {
      ...productData,
      seoTitle: bestTitle,
      // Resolve full https:// Supabase URLs for each item in the group.
      // Rejects blob: URLs (in-session previews) — Shopify can't fetch those.
      // Falls back to storagePath reconstruction if imageUrls is missing/blob.
      imageUrls: group.map(item => resolvePublicUrl(item)).filter(Boolean),
      imageCount: group.length
    };
  });

  // Second pass: make every title unique against BOTH (a) other products in this export
  // and (b) titles that already exist in the DB from other batches (existingTitles).
  // A single running used-set, seeded with the existing titles, handles both: the first
  // unused title stays as-is; any collision gets " 2", " 3", … until free. This guarantees
  // no duplicate titles in the file AND no conflict with an already-uploaded product.
  const usedTitles = new Set<string>(existingTitles);
  const products = rawProducts.map((p, idx) => {
    const baseTitle = (p.seoTitle && p.seoTitle.trim()) || `product-${idx + 1}`;
    let candidate = baseTitle;
    let n = 2;
    while (usedTitles.has(candidate.toLowerCase())) {
      candidate = `${baseTitle} ${n++}`;
    }
    usedTitles.add(candidate.toLowerCase());
    return { ...p, seoTitle: candidate };
  });

  // Products with no price or a price of 0 — Shopify requires a real price, so block export.
  const invalidPricedProducts = products
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => {
      const n = p.price == null ? NaN : parseFloat(String(p.price));
      return isNaN(n) || n <= 0;
    });

  const handleDownloadCSV = () => {
    // Block export until every product has a real price (> 0).
    if (invalidPricedProducts.length > 0) {
      const names = invalidPricedProducts
        .slice(0, 10)
        .map(({ p, idx }) => `• ${buildCleanTitle(p, idx)}`)
        .join('\n');
      const more = invalidPricedProducts.length > 10
        ? `\n…and ${invalidPricedProducts.length - 10} more`
        : '';
      alert(
        `Cannot export — ${invalidPricedProducts.length} ` +
        `product${invalidPricedProducts.length > 1 ? 's have' : ' has'} a price of $0 or no price set.\n` +
        `Set a price in Step 3 for:\n\n${names}${more}`
      );
      return;
    }

    const csvContent = buildShopifyCsv(products, gidOverrides ?? undefined, vendorName, pricingRule);

    // Create and download the file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    // The platform is in the filename because these files pile up in a Downloads
    // folder and importing the eBay-priced CSV into Shopify is a silent, costly
    // mistake. The identity platform keeps the historical filename exactly.
    const stamp = new Date().toISOString().split('T')[0];
    const suffix = pricingRule ? `-${platformSlug(platform.name)}` : '';
    link.setAttribute('download', `shopify-products${suffix}-${stamp}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Release the blob URL (F41). Without this, every export pinned a multi-MB CSV
    // blob in memory for the tab's lifetime. The revoke is deferred a tick because
    // Safari can still be reading the href when click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    track('CSV Exported', { products: products.length, platform: platform.name });
  };

  // Expose downloadCSV so a parent can trigger it via ref
  useImperativeHandle(ref, () => ({ downloadCSV: handleDownloadCSV }));

  return (
    <div className="google-sheet-exporter">
      {!compactMode && (
        <>
          <div className="export-summary">
            <h3>Export Summary</h3>
            <div className="summary-stats">
              <div className="stat-card">
                <span className="stat-number">{products.length}</span>
                <span className="stat-label">Total Products</span>
              </div>
              <div className="stat-card">
                <span className="stat-number">
                  {products.filter(p => p.price).length}
                </span>
                <span className="stat-label">Priced Items</span>
              </div>
              <div className="stat-card">
                <span className="stat-number">
                  {new Set(products.map(p => p.category)).size}
                </span>
                <span className="stat-label">Categories</span>
              </div>
            </div>

            {invalidPricedProducts.length > 0 && (
              <div className="export-price-gate" style={{
                marginTop: '0.75rem', padding: '0.75rem 1rem', borderRadius: 8,
                background: 'var(--danger-dim)', border: '1px solid var(--danger)', color: 'var(--danger)',
                fontSize: 'var(--fs-sm)', fontWeight: 600,
              }}>
                <Ban size={13} style={{ flexShrink: 0 }} /> Export blocked — {invalidPricedProducts.length} product
                {invalidPricedProducts.length > 1 ? 's have' : ' has'} no price (or $0).
                Set a price in Step 3 before exporting:
                <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem', fontWeight: 500 }}>
                  {invalidPricedProducts.slice(0, 8).map(({ p, idx }) => (
                    <li key={p.id || idx}>{buildCleanTitle(p, idx)}</li>
                  ))}
                  {invalidPricedProducts.length > 8 && (
                    <li>…and {invalidPricedProducts.length - 8} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* Platform selector — sits directly above the preview so the table
              underneath is visibly the thing being re-priced. Only rendered
              when the workspace has configured a marketplace; with none, the
              single "Shopify / no adjustment" option would be a control that
              cannot do anything. */}
          {platforms.length > 1 && (
            <div className="export-platform">
              <label className="export-platform-label" htmlFor="export-platform-select">
                <Tags size={14} aria-hidden="true" /> Export prices for
              </label>
              <select
                id="export-platform-select"
                className="export-platform-select"
                value={platform.id}
                onChange={(e) => setPlatformId(e.target.value)}
              >
                {platforms.map(pf => (
                  <option key={pf.id} value={pf.id}>{pf.name}</option>
                ))}
              </select>
              <p className={`export-platform-note${pricingRule ? ' export-platform-note--on' : ''}`}>
                {pricingSummary}
              </p>
            </div>
          )}

          <div className="export-preview">
            <h3>Preview (Shopify Format)</h3>
            <div className="table-container" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '420px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <table className="preview-table" style={{ minWidth: '4800px', borderCollapse: 'collapse', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>
                <thead>
                  {/* Sticky header sits one surface step above the --ink-850 table
                      body so rows scroll under it without bleeding through. */}
                  <tr style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--ink-800)' }}>
                    {[
                      'Handle','Title','Body (HTML)','Vendor','Product Category','Type','Tags','Published',
                      'Option1 Name','Option1 Value','Option1 Linked To',
                      'Option2 Name','Option2 Value','Option2 Linked To',
                      'Option3 Name','Option3 Value','Option3 Linked To',
                      'Variant SKU','Variant Grams','Variant Inventory Tracker',
                      'Variant Inventory Qty','Variant Inventory Policy','Variant Fulfillment Service',
                      'Variant Price','Variant Compare At Price','Variant Requires Shipping','Variant Taxable',
                      'Unit Price Total Measure','Unit Price Total Measure Unit','Unit Price Base Measure','Unit Price Base Measure Unit',
                      'Variant Barcode','Image Src','Image Position','Image Alt Text','Gift Card',
                      'SEO Title','SEO Description',
                      'Color (metafield)','Fabric (metafield)','Target gender (metafield)',
                      'Complementary products','Related products','Related products settings','Search product boosts',
                      'Variant Image','Variant Weight Unit','Variant Tax Code',
                      'Cost per item','Status','Size','Condition',
                    ].map((col, i) => (
                      <th key={i} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '2px solid var(--border)', background: 'var(--ink-800)', color: 'var(--text-primary)', minWidth: i <= 2 ? '180px' : '110px' }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.map((product, idx) => {
                    const cleanTitle = buildCleanTitle(product, idx);
                    const catKey = product.category?.toLowerCase() ?? '';
                    // Same precedence as buildShopifyCsvRows: preset-applied
                    // shopifyProductType wins (full path → category column,
                    // last segment → Type), category-name maps as fallback.
                    // An unrecognized preset path is dropped; a recognized one is
                    // emitted in its canonical spelling (see canonicalTaxonomyPath).
                    const presetShopifyType = (product.shopifyProductType || '').trim();
                    const presetIsPath = presetShopifyType.includes('>');
                    const presetPath = presetIsPath ? canonicalTaxonomyPath(presetShopifyType) : '';
                    const productCategory = presetPath || resolveCategoryPath(catKey);
                    const productType =
                      (presetIsPath ? (presetPath ? presetPath.split('>').pop()!.trim() : '') : presetShopifyType)
                      || resolveProductType(catKey);
                    const vendor = vendorName?.trim() || product.brand || '';
                    const previewHashtags = (product.generatedDescription || '')
                      .match(/#(\w+)/g)?.map((t: string) => t.slice(1)) || [];
                    const tags = previewHashtags.length > 0
                      ? previewHashtags.join(', ')
                      : (product.tags?.join(', ') || '');
                    const primaryColor = product.color || '';
                    // weightValue is stored in grams — use directly, no conversion needed.
                    const rawWeight = parseFloat(product.weightValue || '');
                    const variantGrams = isNaN(rawWeight) ? '' : String(rawWeight);
                    const altParts = [cleanTitle];
                    if (primaryColor && !cleanTitle.toLowerCase().includes(primaryColor.toLowerCase())) altParts.push(primaryColor);
                    if (product.size) altParts.push(baseSize(product.size));
                    const imageAltText = altParts.filter(Boolean).join(' - ');
                    const tr = (v: string | undefined | null, maxLen = 40) => {
                      const s = v ?? '—';
                      return s.length > maxLen ? <span title={s}>{s.substring(0, maxLen)}…</span> : <>{s || '—'}</>;
                    };
                    const cols: (string | null | undefined)[] = [
                      cleanTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || `product-${idx + 1}`, // Handle
                      cleanTitle,                                                    // Title
                      product.generatedDescription?.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>') || '', // Body (HTML)
                      vendor,                                                        // Vendor
                      productCategory,                                               // Product Category
                      productType,                                                   // Type
                      tags,                                                          // Tags
                      product.published === false ? 'false' : 'true',               // Published
                      'Title',                                                       // Option1 Name
                      'Default Title',                                               // Option1 Value
                      '',                                                            // Option1 Linked To
                      '','','',                                                      // Option2 Name/Value/Linked To
                      '','','',                                                      // Option3 Name/Value/Linked To
                      product.sku || '',                                             // Variant SKU
                      variantGrams,                                                  // Variant Grams
                      'shopify',                                                     // Variant Inventory Tracker
                      String(product.inventoryQuantity ?? 1),                       // Variant Inventory Qty
                      product.continueSellingOutOfStock ? 'continue' : 'deny',      // Variant Inventory Policy
                      'manual',                                                      // Variant Fulfillment Service
                      formatPlatformPrice(product.price, pricingRule),                // Variant Price
                      (() => { // Variant Compare At Price — only if strictly greater than sale price
                        // Identical rule to buildShopifyCsvRows, via the same
                        // helpers, so the preview can never disagree with the file.
                        const sale = applyPlatformPrice(toPriceNumber(product.price ?? 0), pricingRule);
                        const rawCompare = toPriceNumber(product.compareAtPrice ?? 0);
                        const compare = pricingRule?.applyToCompareAt ? applyPlatformPrice(rawCompare, pricingRule) : rawCompare;
                        return (compare > sale && compare > 0) ? compare.toFixed(2) : '';
                      })(),
                      product.requiresShipping === false ? 'false' : 'true',        // Variant Requires Shipping
                      'true',                                                        // Variant Taxable
                      '','','','',                                                   // Unit Price columns
                      product.barcode || product.sku || '',                           // Variant Barcode
                      product.imageUrls?.[0] || '',                                 // Image Src
                      '1',                                                           // Image Position
                      imageAltText || cleanTitle,                                   // Image Alt Text
                      'false',                                                       // Gift Card
                      cleanTitle,                                                    // SEO Title
                      product.seoDescription || (product.generatedDescription ? smartSeoTruncate(product.generatedDescription) : ''), // SEO Description
                      resolveColorGid(primaryColor, gidOverrides?.color),            // Color metafield (GID)
                      resolveFabricGid(product.material, gidOverrides?.fabric),      // Fabric metafield (GID)
                      resolveGenderGid(product.gender, gidOverrides?.gender),        // Target gender metafield (GID)
                      '','','','',                                                   // Recommendation metafields
                      '',                                                            // Variant Image
                      'g',                                                           // Variant Weight Unit
                      product.taxCode || '',                                         // Variant Tax Code
                      String(product.costPerItem || '0.00'),                       // Cost per item
                      (product.status || 'active').toLowerCase(),                    // Status
                      baseSize(product.size) || '',                                  // Size (custom.size)
                      product.condition || '',                                       // Condition (custom.condition)
                      product.parcelSize || '',                                      // Parcel Size (custom.parcel_size)
                      product.packageDimensions || '',                               // Package Dimensions (custom.package_dimensions)
                    ];
                    return (
                      <tr key={product.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        {cols.map((val, ci) => (
                          // Empty cells render a placeholder em-dash — --text-faint keeps
                          // them clearly subordinate to real data (--text-primary).
                          <td key={ci} style={{ padding: '5px 10px', color: val ? 'var(--text-primary)' : 'var(--text-faint)', verticalAlign: 'top' }}>
                            {tr(val, ci === 0 || ci === 1 || ci === 40 ? 50 : ci === 2 || ci === 41 ? 60 : 35)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Download button removed — triggered via ref from Step 3 sidebar */}

      {!compactMode && (
        <div className="export-instructions">
          <h3><FileText size={14} style={{ flexShrink: 0 }} /> CSV Export</h3>
          <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', marginTop: '0.5rem', lineHeight: '1.5' }}>
            Downloads a CSV file with <strong>all product data and fields</strong> ready for Shopify import. 
            The CSV includes image URLs that Shopify will automatically fetch during import.
          </p>
          {/* Nested info box inside the accent-tinted .export-instructions panel —
              the translucent info fill keeps it distinct without a second opaque
              surface. Text inherits --text-primary from the page. */}
          <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--info-dim)', borderRadius: '8px', fontSize: 'var(--fs-sm)' }}>
            <strong><CheckCircle2 size={12} style={{ flexShrink: 0 }} /> Includes all fields:</strong>
            <ul style={{ marginTop: '0.5rem', marginBottom: 0, paddingLeft: '1.5rem' }}>
              <li>Product details (title, description, brand, category)</li>
              <li>Pricing (price, compare-at price, cost)</li>
              <li>Variants (size, color, secondary color)</li>
              <li>Inventory (SKU, barcode, quantity)</li>
              <li>Shipping (weight, dimensions, parcel size)</li>
              <li>Product classification (style, gender, age group, size type)</li>
              <li>Policies & marketplace info</li>
              <li>SEO fields (title, description)</li>
              <li>Google Shopping fields (MPN, custom labels)</li>
              <li>Image URLs (automatically fetched by Shopify)</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
});

GoogleSheetExporter.displayName = 'GoogleSheetExporter';

/* Memoized (perf finding F2). Steps 1-4 all mount at once and App re-renders on
 * any store/UI change, so without this a Step-3 keystroke re-rendered this whole
 * subtree. Every prop App passes is now referentially stable (see the
 * `useEventCallback` block in App.tsx), so the default shallow compare bails out
 * on renders that have nothing to do with this component. */
/* memo(forwardRef(...)) is supported: the ref is not part of the compared props.
 * `items` is memoized in App (it used to be an inline IIFE, a new array every
 * render), which is what makes the 54-column preview pipeline stop re-running. */
export default memo(GoogleSheetExporter);
