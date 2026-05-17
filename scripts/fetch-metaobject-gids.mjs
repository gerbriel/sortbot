/**
 * One-time script to fetch Shopify metaobject GIDs for:
 *   - color-pattern
 *   - fabric
 *   - target-gender
 *
 * Usage:
 *   1. Set SHOPIFY_STORE and SHOPIFY_ADMIN_TOKEN below (or as env vars)
 *   2. node scripts/fetch-metaobject-gids.mjs
 *   3. Copy the printed maps into GoogleSheetExporter.tsx
 *
 * To get your Admin API token:
 *   Shopify Admin → Settings → Apps → Develop apps → Create an app
 *   → Configure Admin API scopes: check "read_products", "read_metaobjects"
 *   → Install app → copy the Admin API access token
 */

const STORE   = process.env.SHOPIFY_STORE   || 'YOUR-STORE.myshopify.com';
const TOKEN   = process.env.SHOPIFY_ADMIN_TOKEN || 'YOUR-ADMIN-API-TOKEN';
const API_VER = '2024-01';

const QUERY = `
{
  metaobjectDefinitions(first: 20) {
    edges {
      node {
        type
        metaobjects(first: 60) {
          edges {
            node {
              id
              displayName
            }
          }
        }
      }
    }
  }
}
`;

async function main() {
  const res = await fetch(
    `https://${STORE}/admin/api/${API_VER}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': TOKEN,
      },
      body: JSON.stringify({ query: QUERY }),
    }
  );

  if (!res.ok) {
    console.error('HTTP error', res.status, await res.text());
    process.exit(1);
  }

  const { data, errors } = await res.json();
  if (errors) { console.error(errors); process.exit(1); }

  const TARGET_TYPES = ['shopify--color-pattern', 'shopify--fabric', 'shopify--target-gender',
                        'color_pattern', 'fabric', 'target_gender',
                        'color-pattern', 'target-gender'];

  for (const { node: def } of data.metaobjectDefinitions.edges) {
    if (!TARGET_TYPES.some(t => def.type.toLowerCase().includes(t.replace('shopify--','').replace('_','-')))) continue;

    console.log(`\n// ── ${def.type} ──`);
    console.log(`const MAP_${def.type.replace(/[^a-z0-9]/gi,'_').toUpperCase()} = {`);
    for (const { node: obj } of def.metaobjects.edges) {
      const label = obj.displayName;
      console.log(`  ${JSON.stringify(label.toLowerCase())}: ${JSON.stringify(obj.id)},  // ${label}`);
      // also add common aliases
      if (label === 'Gray') console.log(`  "grey": ${JSON.stringify(obj.id)},`);
      if (label === 'Camouflage') console.log(`  "camo": ${JSON.stringify(obj.id)},`);
      if (label === 'Tie-dye') console.log(`  "tiedye": ${JSON.stringify(obj.id)},`);
    }
    console.log(`};`);
  }
}

main().catch(console.error);
