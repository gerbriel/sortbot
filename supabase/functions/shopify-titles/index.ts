// Supabase Edge Function: shopify-titles
// ---------------------------------------
// Reads every existing product's title + handle from the Shopify Admin API so the CSV
// exporter can avoid creating titles/handles that collide with already-uploaded products.
//
// WHY A FUNCTION (not a direct browser call):
//   - Shopify's Admin API does not allow CORS browser requests.
//   - The Admin token has full read/write to the store and must never ship in the
//     client bundle. Here it lives only as a Supabase secret (server-side).
//
// SECRETS REQUIRED (set via the Supabase CLI — see deploy notes in the chat):
//   SHOPIFY_STORE        e.g. "my-store"  or  "my-store.myshopify.com"
//   SHOPIFY_ADMIN_TOKEN  the Admin API access token (shpat_...)
//
// AUTH: verify_jwt stays ON (default) so only signed-in app users can invoke it.

const SHOPIFY_API_VERSION = "2024-10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Normalize "my-store", "my-store.myshopify.com", or a full URL → "my-store.myshopify.com". */
function resolveShopHost(raw: string): string {
  const cleaned = raw.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return cleaned.includes(".myshopify.com") ? cleaned : `${cleaned}.myshopify.com`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const store = Deno.env.get("SHOPIFY_STORE");
  const token = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
  if (!store || !token) {
    return json(
      { error: "Shopify secrets not configured (SHOPIFY_STORE / SHOPIFY_ADMIN_TOKEN)." },
      500,
    );
  }

  const host = resolveShopHost(store);
  const endpoint = `https://${host}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const query = `
    query ProductTitles($cursor: String) {
      products(first: 250, after: $cursor) {
        edges { cursor node { title handle } }
        pageInfo { hasNextPage }
      }
    }`;

  const titles: string[] = [];
  const handles: string[] = [];

  try {
    let cursor: string | null = null;
    // Hard page cap so a runaway store can't time out the function.
    for (let page = 0; page < 200; page++) {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables: { cursor } }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        return json(
          { error: `Shopify API ${resp.status}`, detail: text.slice(0, 500) },
          502,
        );
      }

      const payload = await resp.json();
      if (payload.errors) {
        return json({ error: "Shopify GraphQL error", detail: payload.errors }, 502);
      }

      const conn = payload?.data?.products;
      if (!conn) break;
      for (const edge of conn.edges ?? []) {
        if (edge?.node?.title) titles.push(edge.node.title);
        if (edge?.node?.handle) handles.push(edge.node.handle);
      }
      if (!conn.pageInfo?.hasNextPage) break;
      cursor = conn.edges?.[conn.edges.length - 1]?.cursor ?? null;
      if (!cursor) break;
    }

    return json({ titles, handles, count: titles.length });
  } catch (err) {
    return json({ error: "Fetch failed", detail: String(err) }, 500);
  }
});
