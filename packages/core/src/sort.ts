import type { DescriptorShape, SortDir, SortExpr } from "./descriptor.js";

/**
 * Resolving a requested sort into something safe to hand a query builder.
 *
 * This is the security boundary for the only client-supplied *identifier* in
 * the system. Everything else a request carries is a value, which the database
 * driver parameterises; a column name is not, and PostgREST puts it straight
 * into the `order` query parameter. Two consequences worth spelling out,
 * because they rule out the obvious defences:
 *
 *   - `order=` accepts a comma-separated list, so a single string can smuggle a
 *     second sort term.
 *   - it also accepts embedded-resource paths, so a string can reach through a
 *     join into a table the caller was never meant to order by.
 *
 * Escaping does not help with either. An allowlist does, and the descriptor
 * already is one: it names exactly which columns are sortable and what each
 * resolves to. So the rule this module enforces is narrow and absolute —
 * **a caller-supplied string is compared against the allowlist and then
 * discarded.** What comes back out is always an expression read from the
 * descriptor.
 */

export interface ResolvedSortTerm {
  readonly expr: SortExpr;
  readonly ascending: boolean;
}

/**
 * The ids a caller may legitimately ask for. Includes `hidden` columns: a
 * resource's default sort is often a column the screen does not display, and it
 * still has to be nameable in a URL.
 */
export function sortableIds(d: DescriptorShape): string[] {
  return d.columns.filter((c) => c.sortBy !== undefined).map((c) => c.id);
}

/**
 * Turns a requested column id and direction into concrete order terms.
 *
 * Total by construction. An id that is unknown, misspelled, not sortable, or
 * carrying a comma simply does not match a column, and the descriptor's own
 * default is used instead. There is no branch that returns the caller's string
 * and no branch that throws — a mangled URL renders a correctly-ordered page
 * rather than an error, which is the same degrade-don't-fail behaviour the
 * pagination params already have.
 *
 * `assertDescriptor` guarantees `defaultSort` names a sortable column, so the
 * fallback cannot itself be missing.
 */
export function resolveSort(
  d: DescriptorShape,
  requestedId: unknown,
  requestedDir: unknown,
): readonly ResolvedSortTerm[] {
  const column =
    (typeof requestedId === "string"
      ? d.columns.find((c) => c.id === requestedId && c.sortBy !== undefined)
      : undefined) ?? d.columns.find((c) => c.id === d.defaultSort.column);

  // Unreachable for a descriptor that passed assertDescriptor, but this module
  // must not depend on that having been called.
  if (!column?.sortBy) {
    throw new Error(
      `resource "${d.name}": defaultSort "${d.defaultSort.column}" resolves to no sortable column.`,
    );
  }

  const dir: SortDir =
    requestedDir === "asc" || requestedDir === "desc" ? requestedDir : d.defaultSort.dir;
  const ascending = dir === "asc";

  const terms = Array.isArray(column.sortBy) ? column.sortBy : [column.sortBy as SortExpr];
  const resolved = terms.map((expr) => ({ expr, ascending }));

  /*
   * Append the primary key as a final tiebreaker.
   *
   * Not cosmetic. Offset pagination over a non-unique sort key is unstable:
   * rows that tie have no defined order, and the database is free to return
   * them differently between the query for page 1 and the query for page 2. So
   * a row can appear on both pages, or on neither. With 67 of 108 audit
   * entries sharing an action, ordering by action alone makes that likely
   * rather than theoretical.
   *
   * A unique trailing term gives every row a total order, which makes paging
   * deterministic. Skipped when the key is already in the terms, so it is never
   * ordered by twice.
   */
  if (!terms.includes(d.idColumn)) {
    resolved.push({ expr: d.idColumn, ascending });
  }

  return resolved;
}

/**
 * Whether a column should show a sort control. Distinct from "is in the
 * allowlist" only in that it is about the header, not the request.
 */
export function isSortable(d: DescriptorShape, columnId: string): boolean {
  return d.columns.some((c) => c.id === columnId && c.sortBy !== undefined);
}
