import { expect, test } from "@playwright/test";
import { STATES, callRpc, navLinks } from "./helpers";

/**
 * Role-aware UI and the endpoints underneath it.
 *
 * Ported from scripts/verify-app.mjs. The nav assertions now query the
 * accessibility tree by role rather than matching substrings in innerHTML, so
 * they say what they mean and survive markup changes.
 */

test.describe("viewer", () => {
  test.use({ storageState: STATES.viewer });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("lands on their org dashboard", async ({ page }) => {
    await expect(page).toHaveURL(/\/acme$/);
    await expect(page.getByRole("heading", { name: "Acme Corporation" })).toBeVisible();
  });

  test("nav omits Settings and Audit log but offers Projects", async ({ page }) => {
    const links = await navLinks(page);
    expect(links).toContain("Projects");
    expect(links).not.toContain("Settings");
    expect(links).not.toContain("Audit log");
  });

  test("can read projects", async ({ page }) => {
    await page.goto("/acme/projects");
    await expect(page.getByText("Web Platform")).toBeVisible();
  });

  test("is not offered a create-project form", async ({ page }) => {
    await page.goto("/acme/projects");
    await expect(page.locator("form.inline-form")).toHaveCount(0);
  });

  // The point of the whole architecture: the UI hiding a control is cosmetic,
  // the endpoint refusing the call is the actual protection.
  test("calling createProject directly is refused", async ({ page }) => {
    const res = await callRpc(page, "projects", "createProject", {
      orgSlug: "acme",
      name: "Bypassed the UI",
      key: "HACK",
    });
    expect(res.ok).toBe(false);
  });

  test("calling listAuditLog directly is refused", async ({ page }) => {
    const res = await callRpc(page, "org", "listAuditLog", { orgSlug: "acme", page: 1 });
    expect(res.ok).toBe(false);
  });

  test("calling inviteMember directly is refused", async ({ page }) => {
    const res = await callRpc(page, "members", "inviteMember", {
      orgSlug: "acme",
      email: "sneaky@acme.test",
      role: "owner",
    });
    expect(res.ok).toBe(false);
  });

  test("cannot reach another tenant via direct RPC", async ({ page }) => {
    const res = await callRpc(page, "projects", "listProjects", { orgSlug: "globex" });
    expect(res.ok).toBe(false);
  });
});

test.describe("owner", () => {
  test.use({ storageState: STATES.owner });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("nav includes Settings and Audit log", async ({ page }) => {
    const links = await navLinks(page);
    expect(links).toContain("Settings");
    expect(links).toContain("Audit log");
  });

  test("can create and delete a project", async ({ page }) => {
    const created = await callRpc(page, "projects", "createProject", {
      orgSlug: "acme",
      name: "Owner Created",
      key: "OWN",
    });
    expect(created.ok).toBe(true);

    const id = (created.value as { id: string }).id;
    const deleted = await callRpc(page, "projects", "deleteProject", {
      orgSlug: "acme",
      projectId: id,
    });
    expect(deleted.ok).toBe(true);
  });

  test("cannot reach another tenant via direct RPC", async ({ page }) => {
    const res = await callRpc(page, "projects", "listProjects", { orgSlug: "globex" });
    expect(res.ok).toBe(false);
  });

  test("navigating to a foreign org shows Not found", async ({ page }) => {
    await page.goto("/globex");
    await expect(page.getByText(/not found/i)).toBeVisible();
  });
});
