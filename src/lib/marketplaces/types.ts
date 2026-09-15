/**
 * MULTI-MARKETPLACE PUBLISHING — the contract every adapter and every consumer
 * is written against. Plan: docs/marketplaces/00-plan.md.
 *
 * One canonical listing (a ClothingItem photo group, its fields coalesced) goes
 * through ONE adapter per marketplace. An adapter is pure: it holds that
 * marketplace's rules AS DATA (`spec`), says what is missing (`validate`),
 * produces the marketplace-shaped listing (`format`), and — where the
 * marketplace takes a file — serialises a batch of them (`serialize`).
 * Delivery (download, copy-to-clipboard packs, and later the API connectors)
 * lives outside the adapter.
 *
 * Nothing in this module touches the network, the DOM or Supabase. The
 * workspace's own vocabulary corrections reach an adapter through the
 * `VocabResolver` it is handed, so the adapter never knows where they live.
 */

import type { ClothingItem } from '../../App';
import type { PlatformPricingRule } from '../platformPricing';
import type { DescriptionSettings } from '../descriptionSettings';

/** Stable keys. Also the values stored in the database (org_marketplaces,
 *  listing_publications, workflow_batches.target_marketplaces). Never rename. */
export type MarketplaceKey =
  | 'shopify' | 'ebay' | 'etsy' | 'poshmark' | 'mercari'
  | 'grailed' | 'depop' | 'facebook' | 'vinted' | 'whatnot';

export const MARKETPLACE_KEYS: readonly MarketplaceKey[] = [
  'shopify', 'ebay', 'etsy', 'poshmark', 'mercari',
  'grailed', 'depop', 'facebook', 'vinted', 'whatnot',
];

export const isMarketplaceKey = (v: unknown): v is MarketplaceKey =>
  typeof v === 'string' && (MARKETPLACE_KEYS as readonly string[]).includes(v);

/**
 * How a listing reaches the marketplace.
 *   feed — a file the seller uploads (CSV / catalog feed).
 *   pack — copy-ready text per field + ordered photos; the seller pastes into
 *          the marketplace's own app (the marketplaces that forbid automation).
 *   api  — an Edge Function with the workspace's OAuth token (phase 3, later).
 */
export type DeliveryChannel = 'feed' | 'pack' | 'api';

/** The canonical condition scale. Every marketplace's own vocabulary maps FROM this. */
export type ConditionGrade =
  | 'new_with_tags' | 'new_without_tags' | 'excellent' | 'good' | 'fair' | 'poor';

export const CONDITION_GRADES: readonly ConditionGrade[] = [
  'new_with_tags', 'new_without_tags', 'excellent', 'good', 'fair', 'poor',
];

/** The controlled fields a marketplace may keep a fixed list for. */
export type VocabKind = 'brand' | 'color' | 'condition' | 'size' | 'category';

/**
 * A marketplace's rules, as data. Every number here is confirmed against the
 * marketplace's current seller documentation before `verified` is set true;
 * until then the adapter still works, and the readiness checklist says the
 * limits are provisional.
 */
export interface MarketplaceSpec {
  key: MarketplaceKey;
  /** Display name — "eBay", "Facebook Marketplace". */
  name: string;
  /** Channels this marketplace supports TODAY in this app (api is listed only
   *  once a connector exists). */
  channels: readonly DeliveryChannel[];
  title: { max: number };
  description: {
    max: number;
    /** 'plain' — line breaks only; 'html' — the marketplace renders HTML. */
    format: 'plain' | 'html';
  };
  photos: { min: number; max: number };
  tags: {
    /** 0 when the marketplace has no tag field. */
    max: number;
    /** Per-tag character limit, when the marketplace has one. */
    maxLength?: number;
    /** How tags are written: 'tags' as a list, 'hashtags' as #words in the body. */
    style: 'none' | 'tags' | 'hashtags';
  };
  brand: {
    /** True when the marketplace only accepts values from its own picker. */
    controlled: boolean;
    /** The marketplace's documented value for "no matching brand", or null
     *  when the field may be left empty. */
    fallback: string | null;
  };
  color: {
    controlled: boolean;
    /** The marketplace's fixed colour list, when it has one. */
    values?: readonly string[];
    fallback: string | null;
  };
  condition: {
    /** The marketplace's own condition words, in its order. */
    values: readonly string[];
    /** Canonical grade → the marketplace's word. */
    map: Readonly<Record<ConditionGrade, string>>;
  };
  category: {
    /** 'free' text, a 'path' ("A > B > C"), or a numeric/coded 'taxonomy' id. */
    kind: 'free' | 'path' | 'taxonomy';
    fallback?: string;
  };
  /** Where the limits above were read from. */
  docsUrl?: string;
  /** False until the numbers were checked against live documentation. */
  verified: boolean;
}

/**
 * The workspace's answer to "what does THIS marketplace call this value?".
 * Implemented by the service over `marketplace_vocab` (workspace rows first,
 * then the fuzzy brand matcher); tests use a stub. `null` means "no mapping —
 * fall back and warn".
 */
export interface VocabResolver {
  resolve(kind: VocabKind, marketplace: MarketplaceKey, canonical: string): string | null;
}

/** A resolver that maps nothing — the pre-migration state and the test default. */
export const NO_VOCAB: VocabResolver = { resolve: () => null };

/** Everything an adapter needs to describe ONE listing. */
export interface ListingInput {
  /** The photo group, leader first — the order the photos are published in. */
  group: readonly ClothingItem[];
  /** The group's fields coalesced (first non-blank value across the group,
   *  the rule the Shopify export already follows). */
  item: ClothingItem;
  /** Public image URLs in publish order (already resolved from storage). */
  imageUrls: readonly string[];
  /** The seller / shop name (the Shopify Vendor column), never a garment brand. */
  vendorName?: string;
  descriptionSettings?: DescriptionSettings;
  /** The marketplace's price rule from the workspace settings, or null for list price. */
  pricingRule?: PlatformPricingRule | null;
  vocab: VocabResolver;
}

export type IssueLevel = 'error' | 'warning';

/** One line of the readiness checklist. `error` blocks that channel; `warning` does not. */
export interface ReadinessIssue {
  marketplace: MarketplaceKey;
  level: IssueLevel;
  /** The canonical field the issue is about — 'brand', 'photos', 'title', 'price'… */
  field: string;
  message: string;
  /** The value that did not resolve, when there is one — what "remember this
   *  mapping" would map. */
  value?: string;
  /** Set when a vocabulary mapping would fix it. */
  fixKind?: VocabKind;
}

/** A listing in the marketplace's shape. Strings are already cut to the spec's limits. */
export interface FormattedListing {
  marketplace: MarketplaceKey;
  /** The group leader's id — the join key for listing_publications. */
  productGroupId: string;
  sku: string | null;
  title: string;
  description: string;
  tags: string[];
  category: string | null;
  brand: string | null;
  color: string | null;
  /** The marketplace's own condition word (from spec.condition.map), or null. */
  condition: string | null;
  size: string | null;
  /** In dollars, after the marketplace's price rule; null when the listing has no price. */
  price: number | null;
  compareAtPrice: number | null;
  /** Public URLs, already limited to spec.photos.max, leader first. */
  photos: string[];
  /** Marketplace-specific extras — eBay item specifics, Etsy attributes, Facebook
   *  feed columns — keyed by the marketplace's own field names. */
  attributes: Record<string, string>;
  issues: ReadinessIssue[];
  /**
   * The coalesced canonical item this listing was formatted from.
   *
   * ADDITIVE AND OPTIONAL, set by ONE adapter on purpose: Shopify's `serialize`
   * builds a 54-column CSV out of ~30 `ClothingItem` fields that have no place
   * in a marketplace-shaped listing (weight, inventory policy, tax code, parcel
   * size…), and `buildShopifyCsv` is reused verbatim so its golden snapshot
   * stays byte-identical. Every other adapter carries what its feed needs in
   * `attributes` and leaves this undefined — so a consumer that persists a
   * FormattedListing is never storing a whole item by accident.
   */
  source?: ClothingItem;
}

/** The output of `serialize`: one downloadable file. */
export interface SerializedFeed {
  /** e.g. "facebook-catalog-2026-09-15.csv" */
  filename: string;
  /** e.g. "text/csv" */
  mime: string;
  body: string;
  /** How many listings the file carries. */
  count: number;
}

export interface SerializeOptions {
  /** ISO date used in the filename; injected so tests are deterministic. */
  date?: string;
}

export interface MarketplaceAdapter {
  key: MarketplaceKey;
  spec: MarketplaceSpec;
  /** The readiness checklist for one listing. Pure; never throws. */
  validate(input: ListingInput): ReadinessIssue[];
  /** The marketplace-shaped listing. Pure; `issues` repeats `validate`'s result. */
  format(input: ListingInput): FormattedListing;
  /** Present only when the marketplace takes a file (spec.channels includes 'feed'). */
  serialize?(listings: readonly FormattedListing[], opts?: SerializeOptions): SerializedFeed;
}
