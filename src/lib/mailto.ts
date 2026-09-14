/**
 * mailto: link construction — validate, then encode.
 *
 * WHY THIS EXISTS (security audit 05, finding #7): the founder panels compose
 * mail to addresses that arrived from an ANONYMOUS public form
 * (`beta_signups.email`, and `crm_contacts.email` which is synced from it).
 * Interpolating that string raw into `mailto:${email}?subject=…` lets the
 * submitter inject extra mailto headers — `a@b.com?bcc=me@evil.com&body=…`
 * becomes a pre-addressed blind copy of whatever the founder sends, composed in
 * the founder's own mail client.
 *
 * Two layers:
 *   1. Reject anything that is not a plain address. The character class has no
 *      `?`, `&`, `#`, `,`, `;`, `<`, `>`, quote, backslash or whitespace, so no
 *      separator that mailto parses can survive validation.
 *   2. Percent-encode what is left, so a character the regex does allow (`%`,
 *      `+`) cannot change the URL's meaning. `@` is restored because it is the
 *      one delimiter a mailto address is required to contain.
 *
 * A null return means "render the address as plain text, not a link" — never
 * fall back to an unvalidated href.
 *
 * The server half of the same finding is the `beta_signups_email_chk`
 * constraint in supabase/migrations/security_abuse_limits.sql.
 */

/** A plain, single address. Deliberately stricter than RFC 5322: this gates a
 *  URL, so anything exotic is refused rather than escaped-and-hoped-for. */
export const STRICT_EMAIL_RE =
  /^[^\s@,;:<>()[\]\\"?&#%]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

/** True when `addr` is a single plain address safe to place in a URL. */
export function isSafeEmail(addr: unknown): boolean {
  if (typeof addr !== 'string') return false;
  const a = addr.trim();
  // 254 is the RFC 5321 maximum; the length check also caps the URL we build.
  if (!a || a.length > 254) return false;
  return STRICT_EMAIL_RE.test(a);
}

/**
 * Build a `mailto:` href, or null when the address is not a plain address.
 * `subject` and `body` are always percent-encoded, so they are safe to compose
 * from user-supplied names too.
 */
export function safeMailto(addr: unknown, subject?: string, body?: string): string | null {
  if (!isSafeEmail(addr)) return null;
  const a = (addr as string).trim();
  const encoded = encodeURIComponent(a).replace(/%40/g, '@');
  const params: string[] = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${encoded}${params.length ? `?${params.join('&')}` : ''}`;
}
