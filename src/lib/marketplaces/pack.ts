/**
 * marketplaces/pack — the copy-ready listing for a marketplace with no import.
 *
 * Poshmark, Mercari, Grailed and Vinted have no bulk upload, no public listing
 * API, and terms that forbid automating their apps. Every cross-lister on the
 * market solves this the same way and so does this one: the seller opens the
 * marketplace, and the app has already written every field to that
 * marketplace's limits, one tap to copy each.
 *
 * A field with no value is LEFT OUT rather than shown empty — a pack is a row
 * of copy buttons, and a button that copies nothing is a dead control. What is
 * missing is said properly, once, in `issues`.
 */

import { CONDITION_LABELS } from './conditions';
import type { FormattedListing, MarketplaceKey, ReadinessIssue } from './types';

export interface PackField {
  /** What the seller sees above the copy button. */
  label: string;
  value: string;
  /** How the value is put on the clipboard. Only plain text today; a future
   *  HTML marketplace field would add its own kind rather than overloading it. */
  copyAs: 'text';
}

export interface ListingPack {
  marketplace: MarketplaceKey;
  fields: PackField[];
  /** In publish order, already cut to the marketplace's photo limit. */
  photos: string[];
  issues: ReadinessIssue[];
}

/** Labels the standard fields already cover — an attribute repeating one of
 *  them (Grailed's "Designer", which is the brand) is not shown twice. */
const STANDARD_LABELS = new Set([
  'title', 'description', 'tags', 'hashtags', 'brand', 'size', 'color', 'colour',
  'condition', 'category', 'price',
]);

const field = (label: string, value: string | null | undefined): PackField | null => {
  const v = typeof value === 'string' ? value.trim() : '';
  return v ? { label, value: v, copyAs: 'text' } : null;
};

/**
 * The pack for one formatted listing.
 *
 * Price is written as a bare `45.00` with no currency symbol: it is pasted into
 * a price box that wants a number, and every marketplace here rejects "$45.00".
 */
export function buildListingPack(formatted: FormattedListing): ListingPack {
  const isHashtags = formatted.tags.some(t => t.startsWith('#'));
  const block = formatted.tags.join(isHashtags ? ' ' : ', ');
  // On a hashtag marketplace the tags ARE the end of the description — Mercari
  // and Depop have no separate field to paste them into — so a second copy
  // button holding the same text is a control with nowhere to go.
  const tagsAreInTheBody = isHashtags && block !== '' && formatted.description.endsWith(block);

  const candidates: Array<PackField | null> = [
    field('Title', formatted.title),
    field('Description', formatted.description),
    field(isHashtags ? 'Hashtags' : 'Tags', tagsAreInTheBody ? '' : block),
    field('Brand', formatted.brand),
    field('Size', formatted.size),
    field('Color', formatted.color),
    field('Condition', formatted.condition),
    field('Category', formatted.category),
    field('Price', formatted.price !== null ? formatted.price.toFixed(2) : ''),
  ];

  for (const [label, value] of Object.entries(formatted.attributes)) {
    if (STANDARD_LABELS.has(label.trim().toLowerCase())) continue;
    candidates.push(field(label, value));
  }

  return {
    marketplace: formatted.marketplace,
    fields: candidates.filter((f): f is PackField => f !== null),
    photos: [...formatted.photos],
    issues: [...formatted.issues],
  };
}

/**
 * The whole pack as one plain-text block — the "copy all" button.
 *
 * Photos are deliberately NOT in it. The seller uploads image files, and a list
 * of CDN URLs pasted into a Poshmark description is the kind of mistake that is
 * only noticed by a buyer.
 */
export function packToText(pack: ListingPack): string {
  return pack.fields.map(f => `${f.label}\n${f.value}`).join('\n\n');
}

/** The human label for a canonical grade — re-exported so a pack UI does not
 *  have to reach into the conditions module for one string. */
export { CONDITION_LABELS };
