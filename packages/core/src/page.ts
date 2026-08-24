/**
 * Offset pagination arithmetic.
 *
 * Trivial, and worth having in one place anyway: this calculation was written
 * out four times across the server and four more times in the route components,
 * with the off-by-one in `to` re-derived each time.
 */

/** The inclusive row range a page covers, for PostgREST's `range(from, to)`. */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/**
 * Page count for a total. Always at least 1, so an empty list reads
 * "Page 1 of 1" rather than "Page 1 of 0".
 */
export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
