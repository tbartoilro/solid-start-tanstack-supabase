import { expect, test } from "@playwright/test";
import { PASSWORD, navLinks, signIn, signOut } from "./helpers";

/**
 * The onboarding loop: sign up, create an organization, invite, accept.
 *
 * None of this was reachable before — the app could create invitations but had
 * no way to accept one, and no way to create an organization at all, so only
 * the seeded SQL users could ever get in.
 *
 * Two properties are load-bearing and easy to regress:
 *
 *   1. The `orgs` JWT claim is minted at token-issue time, so immediately after
 *      joining an organization the caller's token does not mention it and
 *      requireOrg() would 404 them out of the org they just joined. Landing on
 *      the dashboard is what proves the claim was refreshed.
 *
 *   2. A token proves someone was invited, not that this caller is the invitee.
 *      The wrong-recipient test below is the check that enforces that.
 */

/** Unique per run so repeated local runs do not collide on the email unique index. */
const stamp = process.env.E2E_STAMP ?? String(process.hrtime.bigint()).slice(-8);
const alice = `alice-${stamp}@example.test`;
const bob = `bob-${stamp}@example.test`;
const orgName = `Wonderland ${stamp}`;
const orgSlug = `wonderland-${stamp}`;

/**
 * Reads the accept link out of the Members page.
 *
 * Deliberately not an out-of-band database lookup. An earlier version read the
 * token via PostgREST with the service key from `supabase status -o json`, which
 * worked locally and returned 403 in CI — the CLI version there reports a key
 * PostgREST does not accept as service-role. Depending on the CLI's key naming
 * was the mistake.
 *
 * Reading it from the UI removes that coupling and covers more: with no mail
 * provider configured — CI's state, and every fresh clone's — the page is
 * *supposed* to surface the link, so this asserts the fallback exists rather
 * than working around its absence.
 *
 * Matched by text pattern rather than by class or test id so it survives the
 * Park UI migration.
 */
/** The invitations list, as a named region rather than "wherever this text is". */
function pendingInvitations(page: import("@playwright/test").Page) {
  return page.getByRole("region", { name: "Pending invitations" });
}

async function acceptLinkFromPage(page: import("@playwright/test").Page): Promise<string> {
  const link = page.getByText(/\/accept-invite\?token=[a-f0-9]{64}/);
  await expect(link).toBeVisible();

  const text = (await link.textContent()) ?? "";
  const match = text.match(/https?:\/\/\S*\/accept-invite\?token=[a-f0-9]{64}/);
  if (!match) throw new Error(`no accept link in: ${text}`);
  return match[0];
}

async function signUp(
  page: import("@playwright/test").Page,
  email: string,
  name: string,
  { navigate = true }: { navigate?: boolean } = {},
) {
  if (navigate) await page.goto("/signup");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
}

test.describe.configure({ mode: "serial" });

test("a new user can sign up and reaches the org chooser", async ({ page }) => {
  await signUp(page, alice, "Alice Liddell");
  await expect(page).toHaveURL(/\/select-org/);
  await expect(page.getByText("not a member of any organization")).toBeVisible();
  // The dead end this replaced simply told the user to ask an administrator.
  await expect(page.getByRole("link", { name: "Create an organization" })).toBeVisible();
});

test("creating an organization lands the creator inside it as owner", async ({ page }) => {
  await signIn(page, alice);
  await page.goto("/new-org");
  await page.getByLabel("Organization name").fill(orgName);
  await page.getByRole("button", { name: "Create organization" }).click();

  // Reaching this URL at all is the JWT-refresh assertion described above.
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}$`));

  const links = await navLinks(page);
  expect(links).toContain("Settings");
  expect(links).toContain("Audit log");
});

test("an invitation can be created and then accepted by its recipient", async ({ page }) => {
  await signIn(page, alice);
  await page.goto(`/${orgSlug}/members`);
  await page.getByLabel("Invite by email").fill(bob);
  await page.getByRole("button", { name: "Send invite" }).click();

  // Scoped to the pending-invitations region, because the address lands on this
  // page twice: once in the copy-the-link fallback (there is no mail provider
  // configured in tests, which is the point of acceptLinkFromPage below) and
  // once in the list. Matching the bare text found both and failed strict mode
  // whenever the list had finished rendering — it only ever passed by winning a
  // race against the refetch. The list is also the assertion worth making: it
  // is the stored invitation, not a transient banner.
  await expect(pendingInvitations(page).getByText(bob)).toBeVisible();

  const acceptUrl = await acceptLinkFromPage(page);
  const token = new URL(acceptUrl).searchParams.get("token") ?? "";
  expect(token).toMatch(/^[a-f0-9]{64}$/);

  await signOut(page);

  // An invitee has no account yet, so the link must route through signup while
  // preserving the token.
  await page.goto(`/accept-invite?token=${token}`);
  await expect(page).toHaveURL(new RegExp(`/signup\\?invite=${token}`));

  await signUp(page, bob, "Bob Hatter", { navigate: false });
  await expect(page).toHaveURL(new RegExp(`/accept-invite\\?token=${token}`));
  await expect(page.getByRole("heading", { name: `Join ${orgName}` })).toBeVisible();

  await page.getByRole("button", { name: `Join ${orgName}` }).click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}$`));

  // Joined as member, so the privileged links must be absent.
  const links = await navLinks(page);
  expect(links).toContain("Projects");
  expect(links).not.toContain("Settings");
  expect(links).not.toContain("Audit log");
});

test("a signed-in user cannot redeem an invitation addressed to someone else", async ({ page }) => {
  await signIn(page, alice);
  await page.goto(`/${orgSlug}/members`);
  const target = `carol-${stamp}@example.test`;
  await page.getByLabel("Invite by email").fill(target);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(pendingInvitations(page).getByText(target)).toBeVisible();

  const token = new URL(await acceptLinkFromPage(page)).searchParams.get("token") ?? "";

  // Alice is signed in, but the invitation is addressed to Carol. The UI says
  // so, and the button is disabled — the database would refuse it regardless.
  await page.goto(`/accept-invite?token=${token}`);
  await expect(page.getByText(/was sent to/i)).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`Join ${orgName}`) })).toBeDisabled();
});
