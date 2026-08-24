import {
  escapeLike,
  pageRange,
  resolveSort,
  searchableExprs,
  sortableIds,
  type ResourceDescriptor,
} from "@orgadmin/core";
import { z } from "zod";

/**
 * Turning a descriptor into a validated request schema and a tenant-scoped
 * query.
 *
 * This package deliberately does not import `@supabase/supabase-js`. The query
 * builder arrives as a structural type — anything with `order`, `ilike`, `or`
 * and `range` satisfies it, which PostgREST's builder does by coincidence of
 * having those methods. Two things fall out of that. The list logic is testable
 * with a recording stub and no database, which is how the sort allowlist gets
 * asserted directly. And the dependency arrow points the right way: the app
 * depends on this, not the reverse.
 */

/**
 * The subset of a PostgREST filter builder this module uses.
 *
 * Each method returns the builder, which is what lets the calls chain. The
 * generic is the concrete builder type so the app keeps its own return type
 * through the call.
 */
export interface ListQuery<TSelf> {
  order(column: string, options: { ascending: boolean }): TSelf;
  ilike(column: string, pattern: string): TSelf;
  or(filters: string): TSelf;
  range(from: number, to: number): TSelf;
}

type AnyDescriptor = ResourceDescriptor<never, never, never>;

/** What `listSchemaFor` guarantees a handler receives. */
export interface ListInput {
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  search?: string | undefined;
}

/**
 * The list request schema for a resource, extending whatever base the app uses
 * to carry tenancy.
 *
 * Every field degrades rather than rejecting. A mangled URL should render a
 * sensible page, not a validation error — the same choice the existing
 * pagination params already made, and the reason `.catch()` appears throughout.
 *
 * `sort` is the important one. It is `z.enum` over the descriptor's sortable
 * ids, so parsing yields a union of known literals and an unrecognised value
 * cannot survive. That is the first of two barriers; `resolveSort` in core is
 * the second, and it is the one that holds even if this schema is bypassed.
 *
 * `pageSize`'s ceiling is not decoration: these are public HTTP endpoints, so a
 * limit the UI happens to respect is not a limit.
 */
export function listSchemaFor<TBase extends z.ZodObject<z.ZodRawShape>>(
  d: AnyDescriptor,
  base: TBase,
) {
  const ids = sortableIds(d);
  if (ids.length === 0) {
    throw new Error(
      `resource "${d.name}": no sortable columns, so no list schema can be built. ` +
        `At least the default sort's column needs a sortBy.`,
    );
  }

  return base.extend({
    page: z.coerce.number().int().min(1).catch(1),
    pageSize: z.coerce.number().int().min(1).max(100).catch(d.pageSize),
    sort: z.enum(ids as [string, ...string[]]).catch(d.defaultSort.column),
    dir: z.enum(["asc", "desc"]).catch(d.defaultSort.dir),
    search: z.string().trim().max(200).optional(),
  });
}

/**
 * Applies ordering, search and pagination to a query.
 *
 * The ordering comes from `resolveSort`, which only ever returns expressions it
 * read out of the descriptor — `input.sort` is used to *look up* a column and
 * then discarded. Nothing from the request reaches `order()`.
 */
export function applyList<TSelf extends ListQuery<TSelf>>(
  query: TSelf,
  d: AnyDescriptor,
  input: ListInput,
): TSelf {
  let out = query;

  for (const { expr, ascending } of resolveSort(d, input.sort, input.dir)) {
    out = out.order(expr, { ascending });
  }

  if (input.search) {
    const targets = searchableExprs(d);
    if (targets.length === 1) {
      out = out.ilike(targets[0]!, `%${escapeLike(input.search)}%`);
    } else if (targets.length > 1) {
      // PostgREST's `or` takes its own comma-separated mini-syntax, in which a
      // comma separates alternatives and would otherwise be read as one. The
      // search text is escaped for LIKE above; here it also cannot be allowed
      // to introduce a comma or parenthesis, so it is wrapped in double quotes,
      // which is how PostgREST delimits a value containing either.
      const pattern = escapeLike(input.search).replace(/"/g, '\\"');
      out = out.or(targets.map((t) => `${t}.ilike."%${pattern}%"`).join(","));
    }
  }

  const { from, to } = pageRange(input.page, input.pageSize);
  return out.range(from, to);
}
