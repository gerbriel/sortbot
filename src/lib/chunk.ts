/**
 * chunk — the ONE way this codebase splits an id list into request-sized batches.
 *
 * WHY 100: PostgREST returns 400 once an `IN(...)` list makes the request URL too
 * long — observed at ~794 ids (CLAUDE.md §11). 100 is the value every call site
 * already used; it was just spelled six different ways (`DELETE_CHUNK_SIZE`,
 * `CHUNK`, `OCHUNK`, and several bare `100` literals) across ~18 hand-written
 * `for (let i = 0; i < xs.length; i += N)` loops (architecture review duplicate #8).
 * One of them is why `registerItemsInDB` has a comment warning not to remove the
 * chunking loop: there is no way to tell from a call site whether its neighbour
 * got the bound right.
 *
 * Not every caller is bounded by the URL limit — the EXIF rescan chunks at 5 to
 * bound CONCURRENCY, not URL length. Those pass an explicit size.
 */

/** The PostgREST `IN(...)` URL-length bound. Do not raise without measuring. */
export const ID_CHUNK = 100;

export function chunked<T>(xs: readonly T[], size = ID_CHUNK): T[][] {
  if (!Number.isInteger(size) || size <= 0) throw new Error('chunked: size must be a positive integer');
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
