import { expect, test } from "@playwright/test";
import { callRpc, STATES } from "./helpers";

/**
 * Server-side sorting, and the allowlist that keeps it safe.
 *
 * Sorting is the only place a client supplies an *identifier* rather than a
 * value. Values are parameterised by the driver; a column name is not —
 * PostgREST serialises it into the `order` query parameter, which accepts
 * comma-separated lists and embedded-resource paths. So a string that reached
 * `order()` could add a sort term or order by a table through a join.
 *
 * The mitigation is an allowlist, not an escape: the request names a column
 * *id*, the descriptor resolves it to a physical expression, and the caller's
 * string is discarded. There is a unit test for that with a recording stub;
 * this asserts it through the real transport against the real database, which
 * is the only place the claim is actually settled.
 *
 * Called through `callRpc` rather than the UI, deliberately. A sort control
 * only offers the values it knows about — the interesting request is the one
 * nobody's interface would send.
 */

interface AuditPage {
  entries: Array<{ id: number; action: string; createdAt: string }>;
  total: number;
}

type Sig = { ids: number[]; actions: string[]; newest: string | undefined };

test.describe("audit log sorting", () => {
  test.use({ storageState: STATES.owner });

  /** The first few rows, as a comparable fingerprint of the ordering. */
  async function signature(
    page: import("@playwright/test").Page,
    payload: Record<string, unknown>,
  ): Promise<Sig> {
    const res = await callRpc(page, "org", "listAuditLog", { orgSlug: "acme", ...payload });
    expect(res.ok, `listAuditLog failed: ${res.message}`).toBe(true);
    const value = res.value as AuditPage;
    expect(value.total).toBeGreaterThan(0);
    return {
      // Ids as well as actions: 67 of the 108 seeded-plus-demo audit rows share
      // the action "member.added", so actions alone cannot tell one page of a
      // sorted list from another.
      ids: value.entries.slice(0, 5).map((e) => e.id),
      actions: value.entries.slice(0, 5).map((e) => e.action),
      newest: value.entries[0]?.createdAt,
    };
  }

  test("sorts by a permitted column in both directions", async ({ page }) => {
    await page.goto("/acme");

    const asc = await signature(page, { sort: "action", dir: "asc" });
    const desc = await signature(page, { sort: "action", dir: "desc" });

    // Ascending starts at the alphabetically first action and descending at the
    // last, so the two must disagree — a sort control that changes nothing is
    // the failure this catches.
    expect(asc.actions).not.toEqual(desc.actions);
    expect([...asc.actions].sort()).toEqual(asc.actions);
    expect([...desc.actions].sort().reverse()).toEqual(desc.actions);
  });

  /**
   * Each of these would do something if the column name survived to the query.
   * All must be indistinguishable from asking for nothing at all.
   */
  test("refuses a smuggled sort column, silently and identically", async ({ page }) => {
    await page.goto("/acme");

    const fallback = await signature(page, {});

    const rejected = [
      "action,id", // a comma adds a second sort term
      "action.asc,created_at.desc", // ...as does the full multi-column form
      "profiles(email)", // an embedded path reaches through a join
      "profiles(full_name)",
      "created_at", // the physical name is not a column id
      "id",
      "actor", // a real column, but deliberately not sortable
      "",
      "action);select 1--",
    ];

    for (const sort of rejected) {
      // `dir` matches the descriptor's default, so a rejected column must
      // reproduce the no-arguments result exactly rather than merely differ
      // from the sort it asked for.
      const attempt = await signature(page, { sort, dir: "desc" });
      expect(attempt, `sort=${JSON.stringify(sort)} was not rejected`).toEqual(fallback);
    }
  });

  test("degrades a bad direction instead of failing", async ({ page }) => {
    await page.goto("/acme");

    // A mangled URL should render a page. The schema catches rather than
    // rejects, which is the same choice `page` already made.
    const bogus = await signature(page, { sort: "action", dir: "sideways" });
    const explicit = await signature(page, { sort: "action", dir: "desc" });
    expect(bogus).toEqual(explicit);
  });

  test("keeps sorting and paging independent", async ({ page }) => {
    await page.goto("/acme");

    const first = await signature(page, { sort: "action", dir: "asc", page: 1 });
    const second = await signature(page, { sort: "action", dir: "asc", page: 2 });

    // Page 2 of a sorted list must continue the order, not restart it. Compared
    // by id, because with a heavily repeated action the two pages legitimately
    // show the same *values* while being different rows.
    expect(second.ids).not.toEqual(first.ids);
    // And no row may appear on both pages, which is what the primary-key
    // tiebreaker in resolveSort exists to guarantee: offset paging over a
    // non-unique sort key is otherwise free to return a row twice.
    expect(first.ids.filter((id) => second.ids.includes(id))).toEqual([]);
  });
});
