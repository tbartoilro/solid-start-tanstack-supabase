import { expect, test } from "@playwright/test";
import { STATES, callRpc, signIn } from "./helpers";

/**
 * The two owner-only screens, and the permission boundary around them.
 *
 * Neither was covered. Both matter more than they look: settings is the only
 * place org state is mutated from the UI, and the audit log is the only place a
 * tenant can see what was done to it.
 */

test.describe("as owner", () => {
  test.use({ storageState: STATES.owner });

  test("can rename the organization and see it reflected", async ({ page }) => {
    await page.goto("/acme/settings");

    const renamed = "Acme Renamed";
    await page.getByLabel("Organization name").fill(renamed);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    // The name lives in the session payload, so the heading proves the cache was
    // refreshed rather than merely marked stale.
    await page.goto("/acme");
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();

    await page.goto("/acme/settings");
    await page.getByLabel("Organization name").fill("Acme Corporation");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  });

  test("is offered the data export, and it excludes invitation tokens", async ({ page }) => {
    await page.goto("/acme/settings");
    await expect(page.getByRole("button", { name: "Export organization data" })).toBeVisible();

    // Asserting on the payload rather than the download: an export that leaked
    // live invitation tokens would be a credential dump.
    const res = await callRpc(page, "org", "exportOrganization", { orgSlug: "acme" });
    expect(res.ok).toBe(true);
    expect(JSON.stringify(res.value)).not.toContain('"token"');
  });

  test("can read the audit log", async ({ page }) => {
    await page.goto("/acme/audit?page=1");
    await expect(page.getByRole("heading", { name: /audit/i })).toBeVisible();
    // The rename above is itself an audited action, so the table cannot be empty.
    await expect(page.getByRole("table")).toBeVisible();
  });
});

test.describe("as viewer", () => {
  test.use({ storageState: STATES.viewer });

  test("is not offered the data export", async ({ page }) => {
    // A viewer cannot reach /acme/settings at all, so the assertion is that the
    // permission-gated control is absent wherever they can reach.
    await page.goto("/acme");
    await expect(page.getByRole("button", { name: "Export organization data" })).toHaveCount(0);
  });

  test("calling exportOrganization directly is refused", async ({ page }) => {
    await page.goto("/acme");
    const res = await callRpc(page, "org", "exportOrganization", { orgSlug: "acme" });
    expect(res.ok).toBe(false);
  });
});

test("an admin lacks org.export, which is owner-only", async ({ page }) => {
  // Distinguishes "privileged" from "owner": admin holds members.manage and
  // audit.read but must not be able to take a full copy of the tenant.
  await signIn(page, "admin@acme.test");
  const res = await callRpc(page, "org", "exportOrganization", { orgSlug: "acme" });
  expect(res.ok).toBe(false);
});
