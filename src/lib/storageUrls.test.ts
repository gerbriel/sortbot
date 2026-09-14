import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('./testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});

import { publicImageUrl, thumbnailImageUrl, IMAGE_BUCKET } from './storageUrls';

/**
 * The single seam between a storage path and a loadable URL (architecture review
 * finding #12). Every restore path in the app depends on the two invariants
 * locked here: a path produces the CDN URL, and an ABSENT path produces '' —
 * never the string 'undefined' inside a URL, never a throw. ~20 inlined call
 * sites each hand-rolled the second half with a ternary; this module absorbs it.
 */
describe('publicImageUrl', () => {
  it('builds the CDN URL for a path', () => {
    expect(publicImageUrl('u1/p1/file.jpg')).toBe('https://cdn.test/u1/p1/file.jpg');
  });

  it('returns the empty string for every absent-path spelling', () => {
    expect(publicImageUrl(undefined)).toBe('');
    expect(publicImageUrl(null)).toBe('');
    expect(publicImageUrl('')).toBe('');
  });

  it('names the one bucket the app uses', () => {
    expect(IMAGE_BUCKET).toBe('product-images');
  });
});

describe('thumbnailImageUrl', () => {
  it('is identical to publicImageUrl — free tier has no transform add-on', () => {
    expect(thumbnailImageUrl('u1/p1/a.jpg')).toBe(publicImageUrl('u1/p1/a.jpg'));
  });

  it('ignores the legacy size argument the old getThumbnailUrl took', () => {
    expect(thumbnailImageUrl('u1/p1/a.jpg', 300)).toBe(thumbnailImageUrl('u1/p1/a.jpg', 9999));
  });

  it('returns the empty string with no path', () => {
    expect(thumbnailImageUrl(undefined)).toBe('');
  });
});
