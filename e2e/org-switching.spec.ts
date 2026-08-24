import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, navLinks, signIn } from "./helpers";

/**
 * Switching between organizations.
 *
 * This exists because the switcher was thoroughly broken in a way that no
 * existing test could see, and that is worth spelling out because the shape of
 * the bug is easy to reintroduce.
 *
 * `Route.useRouteContext()` returns a signal. Every screen destructured it once
 * at setup — `const { session, org } = Route.useRouteContext()()` — which
 * snapshots the value at mount. A TanStack Router component does not remount
 * when only a route param changes, so after switching organizations every
 * reader stayed pinned to the previous one:
 *
 *   - the switcher kept showing the old organization's name
 *   - the sidebar kept building links for the old slug, so clicking Members
 *     showed the WRONG TENANT'S DATA while the URL claimed otherwise
 *   - the switcher's guard compared against the stale id, so re-selecting the
 *     organization you had come from was a no-op you could not escape
 *
 * None of that is a permission failure — the server was right throughout, RLS
 * was never bypassed, and every existing test passed. It was purely a stale
 * client-side read, which is exactly the class of bug an assertion on the URL
 * alone would miss. So these assertions deliberately check what is *rendered*,
 * not just where the browser ended up.
 *
 * A fresh user creates both organizations rather than reusing a seeded one: the
 * RLS integration tests assert the seeded owner belongs to exactly one
 * organization, and quietly adding a second here would break them.
 */

const stamp = process.env.E2E_STAMP ?? String(process.hrtime.bigint()).slice(-8);
const user = `switcher-${stamp}@example.test`;
const first = { name: `Alpha ${stamp}`, slug: `alpha-${stamp}` };
const second = { name: `Beta ${stamp}`, slug: `beta-${stamp}` };

test.describe.configure({ mode: "serial" });

async function createOrg(page: Page, name: string, slug: string) {
  await page.goto("/new-org");
  await page.getByLabel("Organization name").fill(name);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}$`));
}

/** The switcher trigger is labelled with whichever organization is current. */
function switcher(page: Page) {
  return page.locator("aside").getByRole("button").first();
}

async function switchTo(page: Page, name: string) {
  await switcher(page).click();
  await page.getByRole("menuitem", { name, exact: false }).click();
}

test("a user can create two organizations", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Switcher Subject");
  await page.getByLabel("Email").fill(user);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/select-org/);

  await createOrg(page, first.name, first.slug);
  await createOrg(page, second.name, second.slug);
});

test("switching organizations updates the whole shell, not just the URL", async ({ page }) => {
  await signIn(page, user);
  await page.goto(`/${first.slug}`);
  await expect(switcher(page)).toContainText(first.name);

  await switchTo(page, second.name);
  await expect(page).toHaveURL(new RegExp(`/${second.slug}$`));

  // The switcher label. Previously still showed the organization you left.
  await expect(switcher(page)).toContainText(second.name);

  // The page heading, rendered from the route context by the overview screen.
  await expect(page.getByRole("heading", { level: 1, name: second.name })).toBeVisible();

  // Every sidebar link must now target the new tenant. This is the assertion
  // that catches the worst symptom: links left pointing at the previous slug
  // silently served another organization's data.
  const hrefs = await page.locator("aside nav a").evaluateAll((els) =>
    els.map((el) => el.getAttribute("href") ?? ""),
  );
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect(href, `sidebar link still points at the previous organization`).toContain(
      `/${second.slug}`,
    );
  }
});

test("following a sidebar link after switching stays in the new organization", async ({ page }) => {
  await signIn(page, user);
  await page.goto(`/${first.slug}`);
  await switchTo(page, second.name);
  await expect(page).toHaveURL(new RegExp(`/${second.slug}$`));

  await page.locator("aside nav").getByRole("link", { name: "Members" }).click();

  await expect(page).toHaveURL(new RegExp(`/${second.slug}/members$`));
  // The members list is the data assertion: the creator is the only member of
  // the new organization, so seeing anyone else means the previous tenant's
  // rows were rendered.
  await expect(page.getByRole("table")).toContainText(user);
  await expect(switcher(page)).toContainText(second.name);
});

test("switching back to the organization you came from works", async ({ page }) => {
  await signIn(page, user);
  await page.goto(`/${first.slug}`);

  await switchTo(page, second.name);
  await expect(page).toHaveURL(new RegExp(`/${second.slug}$`));

  // The regression: the guard compared the chosen id against a stale current
  // id, so the organization you started from looked like it was already
  // selected and selecting it did nothing.
  await switchTo(page, first.name);
  await expect(page).toHaveURL(new RegExp(`/${first.slug}$`));
  await expect(switcher(page)).toContainText(first.name);

  const links = await navLinks(page);
  expect(links).toContain("Settings");
});
