import type { ResourceDescriptor } from "./descriptor.js";

/**
 * Text search across a resource's searchable columns.
 */

/**
 * Neutralises LIKE wildcards in a user's search string.
 *
 * Two reasons, and the second is the one people forget. A `%` typed by the user
 * should match a literal percent sign rather than anything-at-all, so the
 * search behaves the way a search box is expected to. And a leading `%` forces
 * a full scan, so leaving them in hands anyone a cheap way to make every
 * keystroke expensive.
 *
 * The backslash itself has to be escaped too, or a trailing one would escape
 * the closing delimiter of the pattern that wraps this.
 *
 * Lifted verbatim from the issues service, which was the only place in the app
 * that got this right.
 */
export function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (match) => `\\${match}`);
}

/** The `ilike` targets a resource searches, in column order. */
export function searchableExprs(d: ResourceDescriptor<never, never, never>): string[] {
  return d.columns
    .map((c) => c.searchAs)
    .filter((expr): expr is string => typeof expr === "string");
}
