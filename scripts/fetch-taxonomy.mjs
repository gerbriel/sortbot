const STORE = process.env.SHOPIFY_STORE || 'jrc1bk-j1.myshopify.com';
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || '';

// Fetch all taxonomy categories and filter to Apparel, Accessories, Footwear, Bags
async function fetchPage(cursor) {
  const after = cursor ? `, after: "${cursor}"` : '';
  const body = JSON.stringify({ query: `{ taxonomy { categories(first: 250${after}) { pageInfo { hasNextPage endCursor } edges { node { id fullName isLeaf } } } } }` });
  const r = await fetch('https://' + STORE + '/admin/api/2024-01/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body
  });
  return r.json();
}

const apparel = [];
let cursor = null;
let hasNext = true;
while (hasNext) {
  const d = await fetchPage(cursor);
  if (!d.data) { console.error(JSON.stringify(d)); break; }
  const { edges, pageInfo } = d.data.taxonomy.categories;
  for (const { node } of edges) {
    const fn = node.fullName;
    if (node.isLeaf && (
      fn.startsWith('Apparel') ||
      fn.startsWith('Clothing') ||
      fn.includes('Footwear') ||
      fn.includes('Shoes') ||
      fn.includes('Bags') ||
      fn.includes('Luggage') ||
      fn.includes('Accessories')
    )) {
      apparel.push(fn + '  |||  ' + node.id);
    }
  }
  hasNext = pageInfo.hasNextPage;
  cursor = pageInfo.endCursor;
}

apparel.sort();
apparel.forEach(l => console.log(l));
