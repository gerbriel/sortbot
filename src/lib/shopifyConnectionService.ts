import { supabase } from './supabase';
import { log } from './debugLogger';

/**
 * shopifyConnectionService — per-org Shopify Admin API credentials.
 *
 * SECURITY: the admin token is WRITE-ONLY from the client. The DB grants
 * (org_shopify_connections.sql) give `authenticated` INSERT on admin_token but
 * no SELECT on that column, so nothing here (and nothing anywhere in the
 * browser) can ever read a token back. Reads happen only in the shopify-titles
 * Edge Function via the service role. Never add admin_token to a select list —
 * it would 42501 anyway.
 *
 * FORWARD-COMPATIBLE: if the migration hasn't been run, getShopifyConnection
 * reports 'unavailable' and the Workspace panel hides the Shopify section.
 */

export interface ShopifyConnectionInfo {
  store_domain: string;
  updated_at: string | null;
}

export type ShopifyConnectionStatus =
  | { status: 'connected'; info: ShopifyConnectionInfo }
  | { status: 'none' }
  | { status: 'unavailable' };

/** Normalize "my-store", "my-store.myshopify.com", or a full URL → "my-store.myshopify.com". */
export function normalizeStoreDomain(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!cleaned) return '';
  return cleaned.includes('.myshopify.com') ? cleaned : `${cleaned}.myshopify.com`;
}

export async function getShopifyConnection(orgId: string): Promise<ShopifyConnectionStatus> {
  try {
    const { data, error } = await supabase
      .from('org_shopify_connections')
      .select('org_id, store_domain, updated_at') // token column is not readable
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) {
      // Table missing (migration not run) or any other failure → hide the UI.
      log.service(`getShopifyConnection | unavailable (${error.code ?? ''} ${error.message})`);
      return { status: 'unavailable' };
    }
    if (!data) return { status: 'none' };
    return {
      status: 'connected',
      info: { store_domain: data.store_domain as string, updated_at: (data.updated_at as string) ?? null },
    };
  } catch (err) {
    log.error(`getShopifyConnection | unexpected: ${String(err)}`);
    return { status: 'unavailable' };
  }
}

/** Connect (or replace) the org's store. Replace-style: delete then insert with
 *  return=minimal, so the token is never echoed back. Admin/owner only (RLS). */
export async function saveShopifyConnection(
  orgId: string,
  storeDomain: string,
  adminToken: string,
): Promise<{ ok: boolean; error?: string }> {
  const domain = normalizeStoreDomain(storeDomain);
  const token = adminToken.trim();
  if (!domain) return { ok: false, error: 'Enter your store domain (e.g. my-store.myshopify.com).' };
  if (!token || /\s/.test(token)) return { ok: false, error: 'Paste the Admin API access token from your custom app.' };
  if (!token.startsWith('shpat_') && !token.startsWith('shppa_')) {
    return { ok: false, error: 'That does not look like an Admin API token (they start with shpat_).' };
  }

  const { error: delErr } = await supabase
    .from('org_shopify_connections').delete().eq('org_id', orgId);
  if (delErr) {
    log.error(`saveShopifyConnection | delete: ${delErr.message}`);
    return { ok: false, error: delErr.message };
  }
  const { error } = await supabase
    .from('org_shopify_connections')
    .insert({ org_id: orgId, store_domain: domain, admin_token: token });
  if (error) {
    log.error(`saveShopifyConnection | insert: ${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function deleteShopifyConnection(orgId: string): Promise<boolean> {
  const { error } = await supabase
    .from('org_shopify_connections').delete().eq('org_id', orgId);
  if (error) { log.error(`deleteShopifyConnection | ${error.message}`); return false; }
  return true;
}
