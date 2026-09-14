import { describe, it, expect } from 'vitest';
import { isSafeEmail, safeMailto } from './mailto';

describe('isSafeEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isSafeEmail('gabriel@example.com')).toBe(true);
    expect(isSafeEmail('first.last+tag@sub.example.co.uk')).toBe(true);
    expect(isSafeEmail('  padded@example.com  ')).toBe(true);
  });

  it('rejects every mailto header separator (finding #7)', () => {
    // These are the payloads that turn the founder's compose window into a
    // pre-addressed blind copy.
    expect(isSafeEmail('a@b.com?bcc=me@evil.com')).toBe(false);
    expect(isSafeEmail('a@b.com&body=hi')).toBe(false);
    expect(isSafeEmail('a@b.com#frag')).toBe(false);
    expect(isSafeEmail('a@b.com,c@d.com')).toBe(false);
    expect(isSafeEmail('a@b.com;c@d.com')).toBe(false);
    expect(isSafeEmail('Name <a@b.com>')).toBe(false);
    expect(isSafeEmail('a@b.com\nbcc: x@y.com')).toBe(false);
    expect(isSafeEmail('a@b.com%0Abcc=x@y.com')).toBe(false);
  });

  it('rejects malformed and non-string input', () => {
    expect(isSafeEmail('')).toBe(false);
    expect(isSafeEmail('no-at-sign.com')).toBe(false);
    expect(isSafeEmail('a@b')).toBe(false);
    expect(isSafeEmail('a@b.c')).toBe(false); // single-char TLD
    expect(isSafeEmail('a@-b.com')).toBe(false);
    expect(isSafeEmail('a@b-.com')).toBe(false);
    expect(isSafeEmail(null)).toBe(false);
    expect(isSafeEmail(undefined)).toBe(false);
    expect(isSafeEmail(42)).toBe(false);
    expect(isSafeEmail(`${'a'.repeat(250)}@example.com`)).toBe(false); // over 254
  });
});

describe('safeMailto', () => {
  it('builds a bare mailto with no params', () => {
    expect(safeMailto('a@b.com')).toBe('mailto:a@b.com');
  });

  it('encodes subject and body', () => {
    expect(safeMailto('a@b.com', 'Hi & bye', 'line one\nline two')).toBe(
      'mailto:a@b.com?subject=Hi%20%26%20bye&body=line%20one%0Aline%20two'
    );
  });

  it('keeps the address readable but encoded', () => {
    // '+' must not stay literal in the URL; '@' must.
    expect(safeMailto('first+tag@b.com')).toBe('mailto:first%2Btag@b.com');
  });

  it('returns null for anything unsafe so the caller renders plain text', () => {
    expect(safeMailto('a@b.com?bcc=evil@x.com', 'Subject')).toBeNull();
    expect(safeMailto('')).toBeNull();
    expect(safeMailto(null)).toBeNull();
  });

  it('omits empty subject and body rather than emitting bare separators', () => {
    expect(safeMailto('a@b.com', '', '')).toBe('mailto:a@b.com');
  });
});
