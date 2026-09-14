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
//   1. No resolvable caller (no user behind the JWT — e.g. the bare anon key,
//      which is a validly signed project JWT and therefore passes verify_jwt)
//      → 401. The anon key is not a user.
//   2. The caller's org has a row in org_shopify_connections → use that store +
//      token (each workspace dedups against ITS OWN catalog). The token is read
//      here via the service role — clients have no SELECT grant on it.
//   3. No connection and the caller is a VERIFIED member of the Founding
//      Workspace (org lookup succeeded AND organizations.slug = 'founding')
//      → fall back to the global SHOPIFY_STORE / SHOPIFY_ADMIN_TOKEN secrets.
//   4. Anything else — no membership, a membership in another org, or a FAILED
//      org lookup → 200 with empty arrays (the exporter then dedups against the
//      app DB only, its normal silent fallback).
//
// SECURITY (audit 05, findings #1/#9/#19):
//   * The global-token fallback fires ONLY for a proven founding member. A
//     failed or absent org lookup must NEVER reach the global secrets — the
//     pre-fix code treated "lookup didn't work" as legacy mode, which let any
//     signup with no workspace dump the founding store's whole catalog.
//     The tenancy migration is live in production, so legacy mode is gone.
//   * store_domain is validated as a single myshopify subdomain label, so a
//     self-service org admin cannot point the fetch at an arbitrary host
//     ("evil.com/.myshopify.com" style SSRF / path smuggling).
//   * Upstream bodies and exception strings are logged server-side only; the
//     caller gets a generic message.
//
// SECRETS: SHOPIFY_STORE / SHOPIFY_ADMIN_TOKEN (founding-workspace fallback only).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// AUTH: verify_jwt stays ON (default) — plus the caller check in step 1.

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

/** The exporter's "nothing to cross-reference" answer. Always a 200 — the
 *  client treats any error as "unavailable" and silently degrades anyway, and
 *  a 200 keeps that path from logging noise for legitimately unconnected orgs. */
function emptyResult(): Response {
  return json({ titles: [], handles: [], count: 0, source: "none" });
}

/** A Shopify store label: one myshopify subdomain, no dots, no path, no port,
 *  no credentials. Length matches DNS's 63-character label limit. */
const SHOP_LABEL_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Normalize "my-store", "my-store.myshopify.com", or "https://my-store.myshopify.com/"
 * → "my-store.myshopify.com". Returns null for ANYTHING that is not a single
 * myshopify label, so the host can never be attacker-chosen (finding #9).
 */
function resolveShopHost(raw: unknown): string | null {
  let label = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "") // scheme
    .replace(/\/.*$/, "") // path — "evil.com/.myshopify.com" → "evil.com"
    .replace(/\?.*$/, "") // query
    .replace(/:\d+$/, "") // port
    .replace(/\.$/, ""); // trailing dot (absolute DNS name)
  const suffix = ".myshopify.com";
  if (label.endsWith(suffix)) label = label.slice(0, -suffix.length);
  // A real store label has no dots, no '@', no whitespace — the regex enforces it.
  if (!SHOP_LABEL_RE.test(label)) return null;
  return `${label}${suffix}`;
}

interface ShopifyConn {
  host: string;
  token: string;
  source: "org" | "global";
}

interface Membership {
  orgId: string;
  orgSlug: string | null;
}

/** Resolve the user behind the JWT. Returns null for the anon key (no user). */
async function resolveUid(
  supaUrl: string,
  serviceKey: string,
  jwt: string,
): Promise<string | null> {
  try {
    const resp = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: serviceKey },
    });
    if (!resp.ok) return null;
    const body = await resp.json();
    const uid = body?.id;
    return typeof uid === "string" && uid ? uid : null;
  } catch (err) {
    console.error("shopify-titles: resolveUid failed", err);
    return null;
  }
}

/** The caller's first org (mirrors default_org_id(): oldest membership wins).
 *  null means "no membership OR the lookup failed" — both must be treated as
 *  "not a founding member", never as legacy mode (finding #1). */
async function firstMembership(
  supaUrl: string,
  serviceKey: string,
  uid: string,
): Promise<Membership | null> {
  try {
    const resp = await fetch(
      `${supaUrl}/rest/v1/org_members?user_id=eq.${encodeURIComponent(uid)}` +
        `&select=org_id,created_at,organizations(slug)&order=created_at.asc&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!resp.ok) {
      console.error("shopify-titles: org_members lookup failed", resp.status);
      return null;
    }
    const rows = await resp.json();
    const orgId = rows?.[0]?.org_id;
    if (typeof orgId !== "string" || !orgId) return null;
    const slug = rows?.[0]?.organizations?.slug;
    return { orgId, orgSlug: typeof slug === "string" ? slug : null };
  } catch (err) {
    console.error("shopify-titles: org_members lookup threw", err);
    return null;
  }
}

/** This org's own Shopify credentials, or null. Read with the service role —
 *  admin_token has no client SELECT grant. */
async function orgConnection(
  supaUrl: string,
  serviceKey: string,
  orgId: string,
): Promise<{ storeDomain: string; token: string } | null> {
  try {
    const resp = await fetch(
      `${supaUrl}/rest/v1/org_shopify_connections?org_id=eq.${encodeURIComponent(orgId)}` +
        `&select=store_domain,admin_token&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    // Not ok = table missing (migration not run) → no connection.
    if (!resp.ok) return null;
    const rows = await resp.json();
    const conn = rows?.[0];
    if (typeof conn?.store_domain === "string" && typeof conn?.admin_token === "string"
      && conn.store_domain && conn.admin_token) {
      return { storeDomain: conn.store_domain, token: conn.admin_token };
    }
    return null;
  } catch (err) {
    console.error("shopify-titles: connection lookup threw", err);
    return null;
  }
}

/** "none"  → return the empty result (unconnected org, no membership, lookup failed)
 *  "unauth" → 401 (no user behind the JWT)
 *  "badhost" → 400 (a connection exists but its store_domain is not a valid store) */
type Resolution = ShopifyConn | "none" | "unauth" | "badhost";

async function resolveConnection(req: Request): Promise<Resolution> {
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");

  // Without the platform env or a token we cannot prove who is calling, and
  // "cannot prove" must never mean "hand over the global token".
  if (!supaUrl || !serviceKey || !jwt) {
    console.error("shopify-titles: missing platform env or Authorization header");
    return "unauth";
  }

  const uid = await resolveUid(supaUrl, serviceKey, jwt);
  if (!uid) return "unauth"; // the anon key is a valid JWT but not a user

  const member = await firstMembership(supaUrl, serviceKey, uid);
  if (!member) return "none";

  const conn = await orgConnection(supaUrl, serviceKey, member.orgId);
  if (conn) {
    const host = resolveShopHost(conn.storeDomain);
    if (!host) return "badhost";
    return { host, token: conn.token, source: "org" };
  }

  // No org connection. The global secrets belong to the founding store and are
  // reachable ONLY by a proven founding member.
  if (member.orgSlug !== "founding") return "none";

  const store = Deno.env.get("SHOPIFY_STORE");
  const token = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
  if (!store || !token) return "none";
  const host = resolveShopHost(store);
  if (!host) {
    console.error("shopify-titles: SHOPIFY_STORE secret is not a valid store domain");
    return "none";
  }
  return { host, token, source: "global" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const resolved = await resolveConnection(req);
  if (resolved === "unauth") return json({ error: "Sign in required." }, 401);
  if (resolved === "badhost") {
    return json({ error: "Invalid store domain — reconnect the store." }, 400);
  }
  if (resolved === "none") {
    // No connection for this workspace: clean no-op, the exporter falls back to
    // DB-only dedup.
    return emptyResult();
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
        // Server log only — an upstream body can carry store detail and token
        // diagnostics, so it never goes back to the caller (finding #19).
        let detail = "";
        try { detail = (await resp.text()).slice(0, 500); } catch { /* ignore */ }
        console.error("shopify-titles: upstream", resp.status, detail);
        return json({ error: "Shopify request failed.", status: resp.status }, 502);
      }

      const payload = await resp.json();
      if (payload.errors) {
        console.error("shopify-titles: graphql errors", JSON.stringify(payload.errors).slice(0, 500));
        return json({ error: "Shopify request failed." }, 502);
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

    // Best-effort metaobject GID maps (color-pattern / fabric / target-gender)
    // so each store's CSV carries ITS OWN metafield GIDs — metaobject ids are
    // store-specific, the client's hardcoded maps only fit the founding store.
    // Requires the token to have the read_metaobjects scope; on any failure the
    // key is simply omitted and the exporter keeps its hardcoded maps.
    let metaobjects: Record<string, Record<string, string>> | undefined;
    try {
      const moQuery = `
        {
          metaobjectDefinitions(first: 50) {
            edges {
              node {
                type
                metaobjects(first: 250) {
                  edges { node { id displayName } }
                }
              }
            }
          }
        }`;
      const moResp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": resolved.token,
        },
        body: JSON.stringify({ query: moQuery }),
      });
      if (moResp.ok) {
        const moPayload = await moResp.json();
        const defs = moPayload?.data?.metaobjectDefinitions?.edges ?? [];
        const maps: Record<string, Record<string, string>> = {};
        for (const edge of defs) {
          const def = edge?.node;
          const t = String(def?.type ?? "").toLowerCase();
          const bucket = t.includes("color") ? "color"
            : t.includes("fabric") ? "fabric"
            : t.includes("gender") ? "gender"
            : null;
          if (!bucket) continue;
          const map: Record<string, string> = maps[bucket] ?? {};
          for (const moEdge of def?.metaobjects?.edges ?? []) {
            const label = moEdge?.node?.displayName;
            const id = moEdge?.node?.id;
            if (label && id) map[String(label).toLowerCase()] = String(id);
          }
          if (Object.keys(map).length > 0) maps[bucket] = map;
        }
        if (Object.keys(maps).length > 0) metaobjects = maps;
      }
    } catch {
      // scope missing / API hiccup → omit metaobjects, titles still returned
    }

    return json({
      titles,
      handles,
      count: titles.length,
      source: resolved.source,
      ...(metaobjects ? { metaobjects } : {}),
    });
  } catch (err) {
    console.error("shopify-titles: fetch failed", err);
    return json({ error: "Fetch failed." }, 500);
  }
});
