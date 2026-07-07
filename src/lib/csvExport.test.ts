import { describe, it, expect } from 'vitest';
import {
  buildShopifyCsv,
  buildShopifyCsvRows,
  SHOPIFY_CSV_HEADERS,
  escapeCsvValue,
  resolveCategoryPath,
  resolveProductType,
  type ExportProduct,
} from './csvExport';

/**
 * Golden-file tests for the Shopify CSV export — the money path.
 * If the snapshot changes, a Shopify import format change happened: verify it
 * against a real Shopify import before updating with `npx vitest run -u`.
 */

const product = (o: Partial<ExportProduct> & { id: string }): ExportProduct =>
  ({ file: null, preview: '', imageUrls: [], ...o } as unknown as ExportProduct);

describe('SHOPIFY_CSV_HEADERS', () => {
  it('has the exact Shopify column count and order anchors', () => {
    expect(SHOPIFY_CSV_HEADERS).toHaveLength(54);
    expect(SHOPIFY_CSV_HEADERS[0]).toBe('Handle');
    expect(SHOPIFY_CSV_HEADERS[1]).toBe('Title');
    expect(SHOPIFY_CSV_HEADERS[23]).toBe('Variant Price');
    expect(SHOPIFY_CSV_HEADERS[53]).toBe('Package Dimensions (product.metafields.custom.package_dimensions)');
  });
});

describe('buildShopifyCsvRows', () => {
  it('every row has exactly as many cells as there are headers', () => {
    const rows = buildShopifyCsvRows([
      product({ id: 'a', seoTitle: 'Vintage Nike Tee', price: 45, category: 'tees', imageUrls: ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg'] }),
      product({ id: 'b', seoTitle: 'Carhartt Jacket', price: 80, category: 'outerwear', imageUrls: ['https://x/4.jpg'] }),
    ]);
    for (const row of rows) expect(row).toHaveLength(SHOPIFY_CSV_HEADERS.length);
  });

  it('emits one main row plus one row per extra image (Handle/Status/Src/Position/Alt only)', () => {
    const rows = buildShopifyCsvRows([
      product({ id: 'a', seoTitle: 'Tee', price: 10, imageUrls: ['https://x/1.jpg', 'https://x/2.jpg'] }),
    ]);
    expect(rows).toHaveLength(2);
    const extra = rows[1];
    const h = SHOPIFY_CSV_HEADERS;
    expect(extra[h.indexOf('Handle')]).toBe('tee');
    expect(extra[h.indexOf('Image Src')]).toBe('https://x/2.jpg');
    expect(extra[h.indexOf('Image Position')]).toBe('2');
    expect(extra[h.indexOf('Title')]).toBe('');       // everything else blank
    expect(extra[h.indexOf('Variant Price')]).toBe('');
  });

  it('deduplicates handles with -2, -3 suffixes when titles collide', () => {
    const rows = buildShopifyCsvRows([
      product({ id: 'a', seoTitle: 'Same Title', price: 10, imageUrls: ['https://x/1.jpg'] }),
      product({ id: 'b', seoTitle: 'Same Title', price: 12, imageUrls: ['https://x/2.jpg'] }),
    ]);
    const handles = rows.map(r => r[0]);
    expect(handles[0]).toBe('same-title');
    expect(handles[1]).toBe('same-title-2');
  });

  it('outputs Compare At Price only when strictly greater than the sale price', () => {
    const h = SHOPIFY_CSV_HEADERS;
    const [cheap] = buildShopifyCsvRows([
      product({ id: 'a', seoTitle: 'T', price: 40, compareAtPrice: 30, imageUrls: ['https://x/1.jpg'] }),
    ]);
    expect(cheap[h.indexOf('Variant Compare At Price')]).toBe('');
    const [dearer] = buildShopifyCsvRows([
      product({ id: 'a', seoTitle: 'T', price: 40, compareAtPrice: 60, imageUrls: ['https://x/1.jpg'] }),
    ]);
    expect(dearer[h.indexOf('Variant Compare At Price')]).toBe('60.00');
  });

  it('strips the "(fits like …)" note from the Size metafield and alt text', () => {
    const h = SHOPIFY_CSV_HEADERS;
    const [row] = buildShopifyCsvRows([
      product({ id: 'a', seoTitle: 'Tee', price: 10, size: 'L (fits like M)', imageUrls: ['https://x/1.jpg'] }),
    ]);
    expect(row[h.indexOf('Size (product.metafields.custom.size)')]).toBe('L');
    expect(row[h.indexOf('Image Alt Text')]).not.toContain('fits like');
  });

  it('extracts tags from #hashtags in the generated description', () => {
    const h = SHOPIFY_CSV_HEADERS;
    const [row] = buildShopifyCsvRows([
      product({ id: 'a', seoTitle: 'Tee', price: 10, generatedDescription: 'Cool tee\n#90s #nike #vintage', imageUrls: ['https://x/1.jpg'] }),
    ]);
    expect(row[h.indexOf('Tags')]).toBe('90s, nike, vintage');
  });
});

describe('taxonomy resolution', () => {
  it('maps gendered category keys to the same ungendered taxonomy path', () => {
    const tees = 'Apparel & Accessories > Clothing > Clothing Tops > T-Shirts';
    expect(resolveCategoryPath('tees')).toBe(tees);
    expect(resolveCategoryPath('mens-tees')).toBe(tees);
    expect(resolveCategoryPath('womens-tees')).toBe(tees);
  });

  it('routes kids categories to the Baby & Children paths', () => {
    expect(resolveCategoryPath('kids-tees')).toContain("Baby & Children's Tops > T-Shirts");
  });

  it('returns blank (never free-form text) for unknown categories', () => {
    expect(resolveCategoryPath('completely-unknown')).toBe('');
  });

  it('resolves store product types with gender prefixes stripped', () => {
    expect(resolveProductType('mens-sweatshirts')).toBe('Sweatshirts');
    expect(resolveProductType('caps')).toBe('Hats & Caps');
  });
});

describe('per-store GID overrides', () => {
  const h = SHOPIFY_CSV_HEADERS;
  const colorCol = h.indexOf('Color (product.metafields.shopify.color-pattern)');
  const genderCol = h.indexOf('Target gender (product.metafields.shopify.target-gender)');

  it('uses the hardcoded founding-store GIDs when no overrides are passed', () => {
    const [row] = buildShopifyCsvRows([
      product({ id: 'a', seoTitle: 'Tee', price: 10, color: 'Black', imageUrls: ['https://x/1.jpg'] }),
    ]);
    expect(row[colorCol]).toBe('gid://shopify/Metaobject/155011809465');
  });

  it('uses the override GID for the connected store instead of the hardcoded one', () => {
    const [row] = buildShopifyCsvRows(
      [product({ id: 'a', seoTitle: 'Tee', price: 10, color: 'Black', gender: 'Men', imageUrls: ['https://x/1.jpg'] })],
      { color: { black: 'gid://shopify/Metaobject/999001' }, gender: { male: 'gid://shopify/Metaobject/999002' } },
    );
    expect(row[colorCol]).toBe('gid://shopify/Metaobject/999001');
    expect(row[genderCol]).toBe('gid://shopify/Metaobject/999002'); // "men" alias → male
  });

  it('resolves color aliases against the override map (cream → beige)', () => {
    const [row] = buildShopifyCsvRows(
      [product({ id: 'a', seoTitle: 'Tee', price: 10, color: 'Cream', imageUrls: ['https://x/1.jpg'] })],
      { color: { beige: 'gid://shopify/Metaobject/999003' } },
    );
    expect(row[colorCol]).toBe('gid://shopify/Metaobject/999003');
  });

  it('never falls back to a foreign hardcoded GID when overrides are present', () => {
    // "Black" exists in the hardcoded map but not in this store's override map —
    // the column must be blank (Shopify leaves the metafield unset), not the
    // founding store's GID which would not resolve in the connected store.
    const [row] = buildShopifyCsvRows(
      [product({ id: 'a', seoTitle: 'Tee', price: 10, color: 'Black', imageUrls: ['https://x/1.jpg'] })],
      { color: { red: 'gid://shopify/Metaobject/999004' } },
    );
    expect(row[colorCol]).toBe('');
  });
});

describe('escapeCsvValue', () => {
  it('quotes values containing commas, quotes, or newlines', () => {
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvValue('plain')).toBe('plain');
  });
});

describe('buildShopifyCsv — golden file', () => {
  it('matches the golden CSV for a representative two-product export', () => {
    const csv = buildShopifyCsv([
      product({
        id: 'a',
        seoTitle: 'XL - Vintage Y2K Nike 90s Tee',
        price: 45,
        compareAtPrice: 65,
        brand: 'Nike',
        category: 'mens-tees',
        size: 'XL (fits like L)',
        color: 'Red',
        material: '100% Cotton',
        gender: 'Men',
        condition: 'Good',
        weightValue: '300',
        generatedDescription: 'XL - Vintage Y2K Nike 90s Tee\n\n✠ SIZE- XL (fits like L)\n✠ Width- 18\n\n#90s #nike',
        imageUrls: ['https://cdn.example/a-1.jpg', 'https://cdn.example/a-2.jpg'],
      }),
      product({
        id: 'b',
        seoTitle: 'Carhartt Detroit Jacket, "Union Made"',
        price: 120,
        brand: 'Carhartt',
        category: 'outerwear',
        size: 'L',
        gender: 'Unisex',
        imageUrls: ['https://cdn.example/b-1.jpg'],
      }),
    ]);
    expect(csv).toMatchSnapshot();
  });
});
