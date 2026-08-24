import type { BulkOutcome } from "@orgadmin/core";
import { z } from "zod";

/**
 * Validating and running a bulk request.
 */

/**
 * How many rows one request may name.
 *
 * A ceiling rather than none, because the ids arrive in the request body and
 * each one becomes work on the server. Selection persists across pages, so a
 * determined click could otherwise name thousands.
 */
export const BULK_MAX_IDS = 500;

/**
 * The id schema for a resource, which is not the same shape for every table.
 *
 * Most tenant tables key on a uuid, but the audit log keys on a bigserial. A
 * single shared uuid check would reject every id it sends, and a shared string
 * check would accept nonsense for the others — so this follows the descriptor.
 */
export function idSchemaFor(d: { idType: "uuid" | "bigint" }): z.ZodType<string> {
  return d.idType === "bigint"
    ? z.coerce.string().regex(/^\d+$/, "Expected a numeric id.")
    : z.guid();
}

/** The bulk request schema for a resource, extending the app's tenancy base. */
export function bulkSchemaFor<TShape extends z.ZodRawShape>(
  d: { idType: "uuid" | "bigint" },
  base: z.ZodObject<TShape>,
) {
  return base.extend({
    ids: z.array(idSchemaFor(d)).min(1).max(BULK_MAX_IDS),
  });
}

/**
 * Runs an operation per id and reports each outcome.
 *
 * Bulk operations partially succeed, and pretending otherwise is the whole
 * problem with them. Removing five members can refuse on the third because it
 * is your own account and on the fourth because it is the last owner, while the
 * other three go through. Collapsing that into one thrown error would either
 * hide three successes or roll back work the database already committed.
 *
 * Sequential, not `Promise.all`. Order matters when the rules are relative to
 * current state — "the last owner" depends on who has already been removed —
 * and a burst of concurrent writes against the same tenant buys nothing here.
 */
export async function runBulk(
  ids: readonly string[],
  operation: (id: string) => Promise<void>,
): Promise<BulkOutcome[]> {
  const outcomes: BulkOutcome[] = [];

  for (const id of ids) {
    try {
      await operation(id);
      outcomes.push({ id, ok: true });
    } catch (error) {
      outcomes.push({
        id,
        ok: false,
        // Deliberately the message, not the error. This value crosses to the
        // client, and the app's error boundary already decides which messages
        // are safe to show; anything it did not sanction arrives here as a
        // generic string.
        error: error instanceof Error ? error.message : "That row could not be updated.",
      });
    }
  }

  return outcomes;
}

/** Whether every row succeeded — for deciding between a toast and a report. */
export function allSucceeded(outcomes: readonly BulkOutcome[]): boolean {
  return outcomes.every((o) => o.ok);
}
