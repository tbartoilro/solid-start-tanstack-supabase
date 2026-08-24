import { expect, test } from "@playwright/test";
import { callRpc, STATES } from "./helpers";

/**
 * Bulk operations, asserted at the endpoint.
 *
 * The interesting claims here are not "the button works". They are that a batch
 * cannot become a way around the per-row rules, that ids from another tenant are
 * inert, and that the audit log stays readable-only. None of those are visible
 * from the UI, so they are called directly — a route guard stops navigation, not
 * a POST.
 */

interface AuditEntry {
  id: number;
}

async function auditIds(page: import("@playwright/test").Page, count: number): Promise<string[]> {
  const res = await callRpc(page, "org", "listAuditLog", { orgSlug: "acme", pageSize: count });
  expect(res.ok, `listAuditLog failed: ${res.message}`).toBe(true);
  const entries = (res.value as { entries: AuditEntry[] }).entries;
  expect(entries.length).toBeGreaterThan(0);
  return entries.slice(0, count).map((e) => String(e.id));
}

test.describe("audit export", () => {
  test.use({ storageState: STATES.owner });

  test("exports the selected entries as CSV", async ({ page }) => {
    await page.goto("/acme");
    const ids = await auditIds(page, 3);

    const res = await callRpc(page, "bulk", "exportAuditEntries", { orgSlug: "acme", ids });
    expect(res.ok, res.message ?? "").toBe(true);

    const result = res.value as { csv: string; filename: string; count: number };
    expect(result.count).toBe(3);
    expect(result.filename).toMatch(/^acme-audit-\d{4}-\d{2}-\d{2}\.csv$/);

    // Header plus one line per entry, CRLF as the format specifies.
    const lines = result.csv.split("\r\n");
    expect(lines[0]).toBe("when,actor,action,target_type,target_id,metadata");
    expect(lines).toHaveLength(4);
  });

  /**
   * The id list is client state that crosses pages, so it is not evidence of
   * anything. A row from another tenant has to be inert rather than refused —
   * refusing would confirm the id exists, which is the same reason a foreign
   * read returns 404 instead of 403.
   */
  test("ignores ids the caller cannot see", async ({ page }) => {
    await page.goto("/acme");
    const real = await auditIds(page, 2);

    const res = await callRpc(page, "bulk", "exportAuditEntries", {
      orgSlug: "acme",
      // A plausible id that is not Acme's. RLS filters it out on the re-read.
      ids: [...real, "999999999"],
    });

    expect(res.ok).toBe(true);
    expect((res.value as { count: number }).count).toBe(2);
  });

  test("rejects an empty or oversized selection", async ({ page }) => {
    await page.goto("/acme");

    const empty = await callRpc(page, "bulk", "exportAuditEntries", { orgSlug: "acme", ids: [] });
    expect(empty.ok).toBe(false);

    // The batch ceiling exists because each id becomes work on the server and
    // selection persists across pages, so a determined click could name
    // thousands.
    const huge = await callRpc(page, "bulk", "exportAuditEntries", {
      orgSlug: "acme",
      ids: Array.from({ length: 501 }, (_, i) => String(i + 1)),
    });
    expect(huge.ok).toBe(false);
  });
});

test.describe("audit export as viewer", () => {
  test.use({ storageState: STATES.viewer });

  test("is refused without the permission", async ({ page }) => {
    await page.goto("/acme");
    const res = await callRpc(page, "bulk", "exportAuditEntries", { orgSlug: "acme", ids: ["1"] });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/audit\.read/);
  });
});

test.describe("bulk mutations", () => {
  test.use({ storageState: STATES.viewer });

  /**
   * The claim that matters most: a batch is not a way around the permission
   * that gates the single-row endpoint.
   */
  test("a viewer cannot bulk-delete issues", async ({ page }) => {
    await page.goto("/acme");

    const list = await callRpc(page, "issues", "listIssues", { orgSlug: "acme", pageSize: 2 });
    expect(list.ok).toBe(true);
    const ids = (list.value as { issues: { id: string }[] }).issues.map((i) => i.id);

    const res = await callRpc(page, "bulk", "bulkDeleteIssues", { orgSlug: "acme", ids });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/issues\.write/);

    // The rows are still there. The status alone would not prove it — an
    // RLS-filtered delete reports no error and no rows.
    const after = await callRpc(page, "issues", "listIssues", { orgSlug: "acme", pageSize: 2 });
    expect((after.value as { issues: { id: string }[] }).issues.map((i) => i.id)).toEqual(ids);
  });
});
