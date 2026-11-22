// Supabase Edge Function: delete-account
// ---------------------------------------
// In-app account deletion (App Store Review Guideline 5.1.1(v)). The signed-in
// caller deletes THEIR OWN account; there is no way to name another user.
//
// FLOW
//   1. POST only. Body must be exactly { "confirm": "DELETE" } (1 KB cap).
//   2. The caller is resolved through /auth/v1/user with their own JWT. The
//      anon key is a validly signed project JWT, so verify_jwt alone never
//      proves a user (AGENTS.md section 9, "Edge Function hardening"). No user -> 401.
//   3. With the service role: POST /rest/v1/rpc/delete_account_data
//      (supabase/migrations/066_account_deletion.sql). One transaction that
//      deletes the workspaces the caller is alone in, leaves the shared ones
//      (reassigning the caller's rows to the successor owner), and anonymises
//      the personal rows. It returns the storage prefixes to remove.
//      Stable refusals come back as P0001 with message 'last_owner' or
//      'founding_admin' and the workspace name in `details` (last_owner also
//      carries the workspace id in `hint`); they map to 409 { code, detail,
//      orgId }. Nothing has changed when they are raised.
//      A P0001 'blocked' (a row the database cannot clear) answers 500
//      { code: 'blocked' }; its detail is logged, never returned.
//   4. DELETE /auth/v1/admin/users/<id>, IMMEDIATELY after the RPC, so a slow
//      storage walk can never leave a memberless user whose account still
//      exists. A 404 (a retry, or a second call that raced this one) is success.
//   5. Best effort: every object under each returned prefix in the
//      product-images bucket is listed (recursively, bounded) and removed in
//      batches. A failure or a hit bound is logged with the prefix as an
//      incomplete cleanup; the answer is still { ok: true }.
//
// ORDER, ON PURPOSE: the RPC runs BEFORE the auth delete, because the shop
// tables reference auth.users ON DELETE CASCADE and the reassignment has to
// happen first. If the auth delete fails, the caller gets a generic 500 and
// can retry: the RPC is idempotent.
//
// ALREADY GONE: a second call whose user was deleted a moment ago fails
// /auth/v1/user. Because verify_jwt is ON, the platform has already verified the
// token's signature, so its `sub` is trustworthy; if the admin API then says
// that user does not exist, the answer is { ok: true }. Nothing is changed on
// that path, so it grants nothing even if verify_jwt were ever turned off.
//
// Upstream bodies and exception strings are logged server side only, never
// returned. verify_jwt stays ON (the default). Deploy by hand:
//   deno check supabase/functions/delete-account/index.ts
//   supabase functions deploy delete-account
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by the platform.

const BUCKET = "product-images";
const MAX_BODY_BYTES = 1024;
/** Storage list page size and remove batch size (the API caps both at 1000). */
const LIST_PAGE = 1000;
const REMOVE_BATCH = 500;
/** Bounds on the walk, so a malformed prefix can never turn into a crawl. */
const MAX_DEPTH = 6;
const MAX_OBJECTS = 200_000;
const MAX_PREFIXES = 500;
const MAX_DETAIL_CHARS = 120;

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

/** `sub` of an authenticated-role JWT, or null. Signature checked by the
 *  platform (verify_jwt ON), so this only reads the payload. */
function jwtSubject(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const payload = JSON.parse(atob(b64));
    const sub = payload?.sub;
    return payload?.role === "authenticated" && typeof sub === "string" && /^[0-9a-f-]{36}$/i.test(sub)
      ? sub : null;
  } catch {
    return null;
  }
}

/** True only when the admin API answers 404 for this user id. */
async function userIsGone(supaUrl: string, serviceKey: string, uid: string): Promise<boolean> {
  try {
    const resp = await fetch(`${supaUrl}/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    return resp.status === 404;
  } catch (err) {
    console.error("delete-account: userIsGone threw", err);
    return false;
  }
}

/** Resolve the user behind the JWT. null for the anon key (no user). */
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
    const uid = (await resp.json())?.id;
    return typeof uid === "string" && /^[0-9a-f-]{36}$/i.test(uid) ? uid : null;
  } catch (err) {
    console.error("delete-account: resolveUid failed", err);
    return null;
  }
}

type RpcOutcome =
  | { kind: "ok"; prefixes: string[] }
  | { kind: "refused"; code: "last_owner" | "founding_admin"; detail: string; orgId?: string }
  | { kind: "blocked" }
  | { kind: "failed" };

async function runRpc(supaUrl: string, serviceKey: string, uid: string): Promise<RpcOutcome> {
  try {
    const resp = await fetch(`${supaUrl}/rest/v1/rpc/delete_account_data`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_user: uid }),
    });
    const text = await resp.text();
    if (!resp.ok) {
      let parsed: { code?: unknown; message?: unknown; details?: unknown; hint?: unknown } = {};
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      if (parsed.code === "P0001" && (parsed.message === "last_owner" || parsed.message === "founding_admin")) {
        const detail = typeof parsed.details === "string" ? parsed.details.slice(0, MAX_DETAIL_CHARS) : "";
        // last_owner carries the workspace id in `hint`; pass it on only when it is a uuid.
        const orgId = typeof parsed.hint === "string" && /^[0-9a-f-]{36}$/i.test(parsed.hint) ? parsed.hint : undefined;
        return { kind: "refused", code: parsed.message, detail, orgId };
      }
      if (parsed.code === "P0001" && parsed.message === "blocked") {
        console.error("delete-account: rpc blocked", typeof parsed.details === "string" ? parsed.details.slice(0, 200) : "");
        return { kind: "blocked" };
      }
      console.error("delete-account: rpc failed", resp.status, text.slice(0, 300));
      return { kind: "failed" };
    }
    const data = JSON.parse(text);
    const raw = Array.isArray(data?.storage_prefixes) ? data.storage_prefixes : [];
    // Only "<uid>/..." prefixes are ever acted on, whatever the database said.
    const prefixes = raw
      .filter((p: unknown): p is string =>
        typeof p === "string" && p.startsWith(`${uid}/`) && !p.includes("..") && p.length < 300)
      .slice(0, MAX_PREFIXES);
    return { kind: "ok", prefixes };
  } catch (err) {
    console.error("delete-account: rpc threw", err);
    return { kind: "failed" };
  }
}

interface ListEntry { name?: unknown; id?: unknown }

/** Every object path under `prefix` (which ends in "/"), depth-first.
 *  Returns false when a bound (depth or object count) cut the walk short. */
async function listObjects(
  supaUrl: string,
  headers: Record<string, string>,
  prefix: string,
  depth: number,
  out: string[],
): Promise<boolean> {
  if (depth > MAX_DEPTH || out.length >= MAX_OBJECTS) return false;
  let complete = true;
  const folder = prefix.replace(/\/+$/, "");
  for (let offset = 0; out.length < MAX_OBJECTS; offset += LIST_PAGE) {
    const resp = await fetch(`${supaUrl}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prefix: folder, limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!resp.ok) {
      console.error("delete-account: storage list failed", resp.status, (await resp.text()).slice(0, 200));
      throw new Error("storage list failed");
    }
    const entries = (await resp.json()) as ListEntry[];
    if (!Array.isArray(entries) || entries.length === 0) return complete;
    for (const e of entries) {
      if (typeof e?.name !== "string" || !e.name || e.name.includes("/")) continue;
      const path = `${folder}/${e.name}`;
      // A folder placeholder has no id; recurse into it.
      if (e.id === null || e.id === undefined) {
        if (!(await listObjects(supaUrl, headers, `${path}/`, depth + 1, out))) complete = false;
      } else {
        out.push(path);
      }
      if (out.length >= MAX_OBJECTS) return false;
    }
    if (entries.length < LIST_PAGE) return complete;
  }
  return false;
}

async function removePrefixes(supaUrl: string, serviceKey: string, prefixes: string[]): Promise<boolean> {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  let ok = true;
  for (const prefix of prefixes) {
    try {
      const paths: string[] = [];
      if (!(await listObjects(supaUrl, headers, prefix, 0, paths))) {
        console.error("delete-account: storage walk hit a bound, cleanup incomplete for prefix", prefix);
        ok = false;
      }
      for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
        const resp = await fetch(`${supaUrl}/storage/v1/object/${BUCKET}`, {
          method: "DELETE",
          headers,
          body: JSON.stringify({ prefixes: paths.slice(i, i + REMOVE_BATCH) }),
        });
        if (!resp.ok) {
          console.error("delete-account: storage remove failed", resp.status, (await resp.text()).slice(0, 200));
          ok = false;
        }
      }
    } catch (err) {
      console.error("delete-account: storage cleanup threw for a prefix", err);
      ok = false;
    }
  }
  return ok;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!supaUrl || !serviceKey || !jwt) {
    console.error("delete-account: missing platform env or Authorization header");
    return json({ error: "Sign in required." }, 401);
  }
  const uid = await resolveUid(supaUrl, serviceKey, jwt);
  // A caller whose account was deleted a moment ago (see ALREADY GONE above).
  // The answer still waits for the confirm body, the same order as below.
  let alreadyGone = false;
  if (!uid) {
    const sub = jwtSubject(jwt);
    if (!sub || !(await userIsGone(supaUrl, serviceKey, sub))) {
      return json({ error: "Sign in required." }, 401);
    }
    alreadyGone = true;
  }

  // ── Bounded body: { "confirm": "DELETE" } and nothing else matters ────────
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: "Request too large." }, 413);
  }
  let confirmed = false;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);
    const body = JSON.parse(raw);
    confirmed = body?.confirm === "DELETE";
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!confirmed) return json({ error: "Confirmation required." }, 400);
  if (alreadyGone || !uid) return json({ ok: true });

  // ── 1. Database (one transaction) ─────────────────────────────────────────
  const outcome = await runRpc(supaUrl, serviceKey, uid);
  if (outcome.kind === "refused") {
    return json({ code: outcome.code, detail: outcome.detail, orgId: outcome.orgId }, 409);
  }
  if (outcome.kind === "blocked") {
    return json({ code: "blocked", error: "Account deletion needs help." }, 500);
  }
  if (outcome.kind === "failed") {
    return json({ error: "Account deletion failed." }, 500);
  }

  // ── 2. The auth user, straight away ───────────────────────────────────────
  try {
    const resp = await fetch(`${supaUrl}/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    // 404: already deleted by a retry or a concurrent call. That is the goal.
    if (!resp.ok && resp.status !== 404) {
      console.error("delete-account: auth delete failed", resp.status, (await resp.text()).slice(0, 300));
      return json({ error: "Account deletion failed." }, 500);
    }
  } catch (err) {
    console.error("delete-account: auth delete threw", err);
    return json({ error: "Account deletion failed." }, 500);
  }

  // ── 3. Storage, best effort ───────────────────────────────────────────────
  if (outcome.prefixes.length > 0) {
    const cleaned = await removePrefixes(supaUrl, serviceKey, outcome.prefixes);
    if (!cleaned) {
      console.error("delete-account: storage cleanup incomplete for prefixes", outcome.prefixes);
    }
  }

  return json({ ok: true });
});
