// Supabase Edge Function: shopify-titles
// ---------------------------------------
// Reads every existing product's title + handle from the Shopify Admin API so the CSV
// exporter can avoid creating titles/handles that collide with already-uploaded products.
//
// WHY A FUNCTION (not a direct browser call):
//   - Shopify's Admin API does not allow CORS browser requests.
//   - Admin tokens have store read/write and must never ship in the client bundle.
//
// PER-ORG RESOLUTION (in order):
//   1. The caller's org has a row in org_shopify_connections → use that store +
//      token (each workspace dedups against ITS OWN catalog). The token is read
//      here via the service role — clients have no SELECT grant on it.
//   2. No connection and the caller is in the Founding Workspace (or the org
//      tables don't exist yet / lookup failed → legacy mode) → fall back to the
//      global SHOPIFY_STORE / SHOPIFY_ADMIN_TOKEN secrets, as before.
//   3. Any other org without a connection → 200 with empty arrays (the exporter
//      then dedups against the app DB only, its normal silent fallback).
//
// SECRETS: SHOPIFY_STORE / SHOPIFY_ADMIN_TOKEN (global fallback only).
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically by the platform.
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

interface ShopifyConn {
  host: string;
  token: string;
  source: "org" | "global";
}

/** Resolve which store to query for this caller. Plain fetch against the
 *  Supabase Auth + PostgREST APIs — no client library needed. Every failure
 *  falls through to the legacy global-secret behavior. */
async function resolveConnection(req: Request): Promise<ShopifyConn | "none" | null> {
  let orgSlug: string | null = null;
  let lookupWorked = false;

  try {
    const supaUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");

    if (supaUrl && serviceKey && jwt) {
      // Who is calling? (verify_jwt already validated the signature; this
      // resolves the user id.)
      const userResp = await fetch(`${supaUrl}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${jwt}`, apikey: serviceKey },
      });
      const uid = userResp.ok ? (await userResp.json())?.id : null;

      if (uid) {
        const restHeaders = {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        };
        // Caller's first org (mirrors default_org_id(): oldest membership wins).
        const memResp = await fetch(
          `${supaUrl}/rest/v1/org_members?user_id=eq.${uid}` +
            `&select=org_id,created_at,organizations(slug)&order=created_at.asc&limit=1`,
          { headers: restHeaders },
        );
        if (memResp.ok) {
          const rows = await memResp.json();
          const orgId: string | undefined = rows?.[0]?.org_id;
          orgSlug = rows?.[0]?.organizations?.slug ?? null;
          if (orgId) {
            lookupWorked = true;
            const connResp = await fetch(
              `${supaUrl}/rest/v1/org_shopify_connections?org_id=eq.${orgId}` +
                `&select=store_domain,admin_token&limit=1`,
              { headers: restHeaders },
            );
            if (connResp.ok) {
              const conns = await connResp.json();
              const conn = conns?.[0];
              if (conn?.store_domain && conn?.admin_token) {
                return {
                  host: resolveShopHost(conn.store_domain),
                  token: conn.admin_token,
                  source: "org",
                };
              }
            }
            // connResp not ok (table missing — migration not run) → fall through
          }
        }
      }
    }
  } catch (_err) {
    // Any lookup failure → legacy behavior below.
  }

  // No org connection. Global secrets apply ONLY to the founding workspace or
  // when the org lookup couldn't run (pre-tenancy legacy mode). Other orgs get
  // a clean empty result — deduping them against someone else's store is wrong.
  if (lookupWorked && orgSlug !== "founding") return "none";

  const store = Deno.env.get("SHOPIFY_STORE");
  const token = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
  if (store && token) {
    return { host: resolveShopHost(store), token, source: "global" };
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const resolved = await resolveConnection(req);
  if (resolved === "none") {
    // Org without a connection: clean no-op, exporter falls back to DB-only dedup.
    return json({ titles: [], handles: [], count: 0, source: "none" });
  }
  if (!resolved) {
    return json(
      { error: "No Shopify connection for this workspace and no global secrets configured." },
      500,
    );
  }

  const endpoint = `https://${resolved.host}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

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
          "X-Shopify-Access-Token": resolved.token,
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

    return json({ titles, handles, count: titles.length, source: resolved.source });
  } catch (err) {
    return json({ error: "Fetch failed", detail: String(err) }, 500);
  }
});
