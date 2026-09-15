/**
 * marketplaces/conditions — free text in, ONE canonical grade out.
 *
 * `ClothingItem.condition` is typed as a small union but holds free text at
 * runtime: the Step 3 dictation grammar routes the spoken word "condition"
 * straight into it (`VOICE_KEYWORD_TO_FIELD`), so what actually arrives is
 * whatever the seller said — "nwt", "excellent used condition", "8/10",
 * "kinda beat up". Every marketplace then wants its own word for it, and no
 * two scales agree: Vinted has five steps, Grailed four, Depop five with
 * different names, Facebook's catalog feed three.
 *
 * So there is exactly one translation: free text → `ConditionGrade` (here) →
 * the marketplace's word (`spec.condition.map`, in each adapter). Nothing
 * downstream parses condition text again.
 *
 * THE RULE WHEN IT CANNOT TELL IS `null`, NEVER A GUESS. A wrong condition is
 * a return, a refund and a rating — the adapter turns a `null` into a readiness
 * warning naming the raw text, which the seller fixes once (or maps in the
 * workspace vocabulary). "Kinda beat up" reads like `poor` to a human and like
 * nothing to a lexicon, and inventing a match for it is exactly how a listing
 * goes out saying "Good" about a garment with a hole in it.
 *
 * Pure: no DOM, no network, no Date, no randomness.
 */

import type { ConditionGrade } from './types';

/** Lowercase, punctuation → spaces, `/` kept (it carries "8/10"), collapsed. */
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ordered patterns — FIRST match wins, so the most specific phrasing is listed
 * first. "new with tags" must be tested before the bare "new", and "excellent
 * used condition" before "used", or a longer phrase resolves to the grade of
 * the shorter word inside it.
 */
const PATTERNS: ReadonlyArray<readonly [RegExp, ConditionGrade]> = [
  // ── new, tags attached ────────────────────────────────────────────────────
  [/\bn\s?w\s?t\b/, 'new_with_tags'],                        // nwt, "n w t"
  [/\bbnwt\b/, 'new_with_tags'],
  [/\bnew\b.{0,12}\bwith\b.{0,6}\btags?\b/, 'new_with_tags'],
  // Tight on purpose. `normalize` keeps `/` (it carries "8/10"), so the gap
  // either side of the "w" is `[\s/]` and not `.{0,4}` — a loose gap here reads
  // "new w/o tags" as "new w … tags" and calls an untagged garment tagged.
  [/\bnew\b[\s/]+w[\s/]+tags?\b/, 'new_with_tags'],               // "new w/ tags"
  [/\btags?\s+(still\s+)?(attached|on)\b/, 'new_with_tags'],
  [/\bdead\s?stock\b/, 'new_with_tags'],                      // unsold old stock, still tagged
  [/\bnib\b|\bnew\s+in\s+(the\s+)?box\b/, 'new_with_tags'],

  // ── new, no tags ──────────────────────────────────────────────────────────
  [/\bn\s?w\s?o\s?t\b/, 'new_without_tags'],
  [/\bnew\b.{0,12}\bwithout\b.{0,6}\btags?\b/, 'new_without_tags'],
  [/\bnew\b.{0,8}\bno\b.{0,4}\btags?\b/, 'new_without_tags'],
  [/\bnew\b.{0,6}\bw[\s/]?o\b.{0,4}\btags?\b/, 'new_without_tags'],  // "new w/o tags"
  [/\bnever\s+worn\b/, 'new_without_tags'],
  [/\bunworn\b/, 'new_without_tags'],
  [/\bbrand\s+new\b/, 'new_without_tags'],

  // ── excellent ─────────────────────────────────────────────────────────────
  [/\bnear\s+mint\b/, 'excellent'],
  [/\bmint\b/, 'excellent'],
  [/\blike\s+new\b/, 'excellent'],
  [/\bpristine\b/, 'excellent'],
  [/\bexcellent\b|\bexc\b|\beuc\b/, 'excellent'],             // euc = excellent used condition
  [/\bvery\s+good\b|\bvgc\b/, 'excellent'],
  [/\bgently\s+(used|worn)\b/, 'excellent'],
  [/\bbarely\s+(used|worn)\b/, 'excellent'],
  [/\bgreat\b/, 'excellent'],

  // ── good ──────────────────────────────────────────────────────────────────
  [/\bguc\b/, 'good'],                                        // good used condition
  [/\b(light|minor|normal|average)\s+wear\b/, 'good'],
  [/\bsolid\b|\bdecent\b|\bsound\b/, 'good'],
  [/\bpre\s?owned\b|\bsecond\s?hand\b/, 'good'],

  // ── fair ──────────────────────────────────────────────────────────────────
  [/\bsatisfactory\b|\bacceptable\b/, 'fair'],
  [/\bwell\s+(worn|loved|used)\b/, 'fair'],
  [/\bvisible\s+wear\b|\bsome\s+flaws?\b|\bflawed\b/, 'fair'],

  // ── poor ──────────────────────────────────────────────────────────────────
  // BEFORE the bare words below: "heavily worn" must not be read by `worn`.
  [/\bpoor\b|\bbad\s+(condition|shape)\b|\brough\s+(condition|shape)\b/, 'poor'],
  [/\bdamaged?\b|\bneeds?\s+repair\b|\bfor\s+parts\b|\bas\s?is\b/, 'poor'],
  [/\bheavily\s+(worn|used|distressed)\b|\bthrashed\b|\btrashed\b/, 'poor'],

  // ── bare words, LAST ──────────────────────────────────────────────────────
  // Every one of these is a substring of a phrase above that means something
  // else ("very good", "like new", "gently worn", "heavily used"), so they can
  // only be read once the phrases have had their turn.
  [/\bgood\b/, 'good'],
  [/\bused\b/, 'good'],
  [/\bfair\b/, 'fair'],
  [/\bworn\b/, 'fair'],
  [/\bnew\b/, 'new_without_tags'],   // bare "new" never claims tags it cannot see
];

/**
 * An out-of-ten score. Resellers write "8/10" and "9 out of 10" constantly, so
 * it is worth reading — but only as a whole-number score out of ten, never as a
 * loose number in a sentence ("worn 10 times" must not become a grade).
 *
 * 10 and 9 → excellent, NOT new: a 10/10 vintage tee is still a used garment,
 * and calling it new is the one direction of this mapping a buyer disputes.
 */
const SCORE_RE = /\b(10|[0-9])\s*(?:\/|\s+out\s+of\s+)\s*10\b/;

function gradeFromScore(text: string): ConditionGrade | null {
  const m = text.match(SCORE_RE);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (n >= 9) return 'excellent';
  if (n >= 7) return 'good';
  if (n >= 5) return 'fair';
  return 'poor';
}

/**
 * The canonical grade for whatever is in the condition field, or `null` when it
 * cannot be told. Adapters turn `null` into a readiness warning that names the
 * raw text — they never substitute a grade.
 */
export function normalizeCondition(text: string | undefined | null): ConditionGrade | null {
  if (typeof text !== 'string') return null;
  const t = normalize(text);
  if (!t) return null;
  for (const [re, grade] of PATTERNS) {
    if (re.test(t)) return grade;
  }
  return gradeFromScore(t);
}

/** Human label for a grade — used in readiness messages and the listing pack. */
export const CONDITION_LABELS: Readonly<Record<ConditionGrade, string>> = {
  new_with_tags: 'New with tags',
  new_without_tags: 'New without tags',
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};
