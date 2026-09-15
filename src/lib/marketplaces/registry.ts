/**
 * marketplaces/registry — every adapter, keyed.
 *
 * The one place a `MarketplaceKey` becomes behaviour. Step 4, the readiness
 * checklist, the feed downloads and the publications matrix all go through
 * here, so a key that exists in the database always has an adapter and the
 * registry test proves it for all ten.
 */

import { MARKETPLACE_KEYS, type DeliveryChannel, type MarketplaceAdapter, type MarketplaceKey } from './types';

import { adapter as shopify } from './shopify';
import { adapter as ebay } from './ebay';
import { adapter as etsy } from './etsy';
import { adapter as poshmark } from './poshmark';
import { adapter as mercari } from './mercari';
import { adapter as grailed } from './grailed';
import { adapter as depop } from './depop';
import { adapter as facebook } from './facebook';
import { adapter as vinted } from './vinted';
import { adapter as whatnot } from './whatnot';

export const ADAPTERS: Readonly<Record<MarketplaceKey, MarketplaceAdapter>> = {
  shopify, ebay, etsy, poshmark, mercari, grailed, depop, facebook, vinted, whatnot,
};

export const getAdapter = (key: MarketplaceKey): MarketplaceAdapter => ADAPTERS[key];

/** Every adapter, in `MARKETPLACE_KEYS` order — which is the order Step 4
 *  renders them in, so it is stable and Shopify stays first. */
export const listAdapters = (): MarketplaceAdapter[] => MARKETPLACE_KEYS.map(k => ADAPTERS[k]);

/** The adapters that deliver through a given channel — 'feed' is the download
 *  list, 'pack' the copy-and-paste list, 'api' the (currently empty) connectors. */
export const adaptersWithChannel = (channel: DeliveryChannel): MarketplaceAdapter[] =>
  listAdapters().filter(a => a.spec.channels.includes(channel));
