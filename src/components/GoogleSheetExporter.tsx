import { forwardRef, useImperativeHandle, useEffect, useState } from 'react';
import type { ClothingItem } from '../App';
import { supabase } from '../lib/supabase';
import { smartSeoTruncate } from '../lib/textAIService';
import {
  baseSize, stripUnresolvedTokens, buildCleanTitle, buildShopifyCsv,
  resolveCategoryPath, resolveProductType,
  resolveColorGid, resolveFabricGid, resolveGenderGid,
} from '../lib/csvExport';
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
    return supabase.storage.from('product-images').getPublicUrl(item.storagePath).data.publicUrl;
  }

  // preview may be a blob URL (in-session before page reload) — reject it
  const preview = item.preview || '';
  if (preview.startsWith('https://')) return preview;

  return '';
}

interface GoogleSheetExporterProps {
  items: ClothingItem[];
  compactMode?: boolean;
}

export interface GoogleSheetExporterHandle {
  downloadCSV: () => void;
}

const GoogleSheetExporter = forwardRef<GoogleSheetExporterHandle, GoogleSheetExporterProps>(
  ({ items, compactMode = false }, ref) => {

  // Titles of products that ALREADY exist in the DB from OTHER batches (a proxy for
  // "already uploaded to Shopify"). Used to suffix this export's titles/handles so a new
  // upload never collides with an existing product. Excludes the current batch's own items
  // so re-exporting the same batch keeps identical titles (Shopify updates, not duplicates).
  const [existingTitles, setExistingTitles] = useState<Set<string>>(new Set());
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
      } catch { /* Shopify read unavailable — DB cross-reference still applies */ }

      if (!cancelled) setExistingTitles(titles);
    })();
    return () => { cancelled = true; };
    // Re-fetch only when the SET of items changes (not on every field keystroke).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

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

    const csvContent = buildShopifyCsv(products);

    // Create and download the file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `shopify-products-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
              <div style={{
                marginTop: '0.75rem', padding: '0.75rem 1rem', borderRadius: 8,
                background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c',
                fontSize: '0.85rem', fontWeight: 600,
              }}>
                🚫 Export blocked — {invalidPricedProducts.length} product
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

          <div className="export-preview">
            <h3>Preview (Shopify Format)</h3>
            <div className="table-container" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '420px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
              <table className="preview-table" style={{ minWidth: '4800px', borderCollapse: 'collapse', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc' }}>
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
                      <th key={i} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '2px solid #e5e7eb', background: '#f8fafc', color: '#374151', minWidth: i <= 2 ? '180px' : '110px' }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.map((product, idx) => {
                    const cleanTitle = buildCleanTitle(product, idx);
                    const catKey = product.category?.toLowerCase() ?? '';
                    const productCategory = resolveCategoryPath(catKey);
                    const productType = resolveProductType(catKey);
                    const vendor = product.brand || '';
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
                      product.price != null ? parseFloat(String(product.price)).toFixed(2) : '', // Variant Price
                      (() => { // Variant Compare At Price — only if strictly greater than sale price
                        const sale = parseFloat(String(product.price ?? 0));
                        const compare = parseFloat(String(product.compareAtPrice ?? 0));
                        return (compare > sale && compare > 0) ? compare.toFixed(2) : '';
                      })(),
                      product.requiresShipping === false ? 'false' : 'true',        // Variant Requires Shipping
                      'true',                                                        // Variant Taxable
                      '','','','',                                                   // Unit Price columns
                      product.barcode || '',                                         // Variant Barcode
                      product.imageUrls?.[0] || '',                                 // Image Src
                      '1',                                                           // Image Position
                      imageAltText || cleanTitle,                                   // Image Alt Text
                      'false',                                                       // Gift Card
                      cleanTitle,                                                    // SEO Title
                      product.seoDescription || (product.generatedDescription ? smartSeoTruncate(product.generatedDescription) : ''), // SEO Description
                      resolveColorGid(primaryColor),                                 // Color metafield (GID)
                      resolveFabricGid(product.material),                            // Fabric metafield (GID)
                      resolveGenderGid(product.gender),                              // Target gender metafield (GID)
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
                      <tr key={product.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        {cols.map((val, ci) => (
                          <td key={ci} style={{ padding: '5px 10px', color: val ? '#111827' : '#9ca3af', verticalAlign: 'top' }}>
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
          <h3>📄 CSV Export</h3>
          <p style={{ fontSize: '0.95rem', color: '#666', marginTop: '0.5rem', lineHeight: '1.5' }}>
            Downloads a CSV file with <strong>all product data and fields</strong> ready for Shopify import. 
            The CSV includes image URLs that Shopify will automatically fetch during import.
          </p>
          <div style={{ marginTop: '1rem', padding: '1rem', background: '#f0f9ff', borderRadius: '8px', fontSize: '0.9rem' }}>
            <strong>✅ Includes all fields:</strong>
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

export default GoogleSheetExporter;
