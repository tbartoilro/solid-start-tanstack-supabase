import { expect, test } from "@playwright/test";
import { PASSWORD, navLinks, signIn, signOut } from "./helpers";
import { execSync } from "node:child_process";

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
 * Reads the invitation token straight from the database.
 *
 * The token only ever reaches a real invitee by email, so a test has to look it
 * up out of band. Done over PostgREST with the service key rather than by
 * shelling out to psql, so the suite needs no postgres client on PATH — which
 * is what CI would otherwise have to install.
 */
async function invitationToken(email: string): Promise<string> {
  // stderr is muted: the CLI prints unrelated "Stopped services" notices that
  // would otherwise interleave with the test reporter output.
  const status = JSON.parse(
    execSync("supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
  );
  const key: string = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;

  const res = await fetch(
    `${status.API_URL}/rest/v1/invitations?select=token&accepted_at=is.null&email=eq.${encodeURIComponent(email)}`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`invitation lookup failed: ${res.status}`);

  const rows = (await res.json()) as { token: string }[];
  const token = rows[0]?.token;
  if (!token) throw new Error(`no pending invitation for ${email}`);
  return token;
}

/**
 * `navigate: false` matters: when arriving here from an invitation redirect the
 * URL already carries `?invite=<token>`, and re-visiting /signup would throw
 * that away — which is exactly how the invited user loses their invitation.
 */
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
  await expect(page.getByText(bob)).toBeVisible();

  const token = await invitationToken(bob);
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
  await expect(page.getByText(target)).toBeVisible();

  const token = await invitationToken(target);

  // Alice is signed in, but the invitation is addressed to Carol. The UI says
  // so, and the button is disabled — the database would refuse it regardless.
  await page.goto(`/accept-invite?token=${token}`);
  await expect(page.getByText(/was sent to/i)).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`Join ${orgName}`) })).toBeDisabled();
});
