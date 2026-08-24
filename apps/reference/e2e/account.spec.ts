import { expect, test } from "@playwright/test";
import { PASSWORD, signIn, signOut } from "./helpers";

/**
 * Account self-service and password recovery.
 *
 * Both flows were entirely untested. Recovery is the interesting one: it spans
 * GoTrue minting a link, an email, a redirect, and a session that exists *only*
 * because the link was followed — so nothing about it is exercised by signing in
 * normally.
 *
 * These use a dedicated seeded account rather than a shared storage state,
 * because changing a password invalidates sessions and would break whatever ran
 * next.
 */

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

interface MailpitSummary {
  messages: { ID: string; To: { Address: string }[] }[];
}

/**
 * Pulls the most recent recovery link addressed to `email` out of Mailpit.
 *
 * Supabase's local stack routes all auth mail here instead of delivering it,
 * which is what makes this flow testable at all — the alternative is minting
 * tokens out of band and never exercising the real link.
 */
async function recoveryLink(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=30`)).json()) as MailpitSummary;

    const match = list.messages.find((m) =>
      m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()),
    );

    if (match) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${match.ID}`)).json()) as {
        Text?: string;
      };

      // The plain-text part, deliberately: the HTML body carries the same URL
      // with &amp; entities and a trailing `">Reset`, and an earlier version of
      // this helper scraped that and produced a link missing `type=recovery` —
      // which GoTrue rejects with "Verify requires a verification type".
      const link = (message.Text ?? "").match(/https?:\/\/\S*\/verify\?\S+/)?.[0];
      if (!link) throw new Error(`no verify link in message to ${email}`);
      return link;
    }

    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no mail for ${email} after waiting`);
}

/** Unique per run so a failed run cannot poison the next one. */
const stamp = process.env.E2E_STAMP ?? String(process.hrtime.bigint()).slice(-8);

test("a forgotten password can be reset through the emailed link", async ({ page }) => {
  // A throwaway account, deliberately. An earlier version ran this against a
  // seeded user and restored the password at the end — which left that account
  // broken for every other spec whenever this test failed partway, and tripped
  // "password should be different from the old password" on the next run. A
  // fresh identity per run makes the test idempotent and side-effect free.
  const email = `reset-${stamp}@example.test`;
  const original = "initial-password-1234";
  const replacement = `replaced-${stamp}`;

  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Reset Subject");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(original);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).not.toHaveURL(/\/signup/);

  await signOut(page);
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" }).catch(() => {});

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();

  // Always reports success, whether or not the address exists — otherwise the
  // endpoint is a membership oracle. So the confirmation proves nothing about
  // delivery; the mail does.
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  // Following this exercises the whole chain: GoTrue validates the recovery
  // token, redirects to /auth/callback with a PKCE code, and that route trades
  // the code for cookies before forwarding here. Without the callback the user
  // arrives with no session and is told the link is invalid.
  await page.goto(await recoveryLink(email));
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();

  await page.getByLabel("New password").fill(replacement);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).not.toHaveURL(/reset-password/);

  // The recovery link signed them in, so /login would bounce straight back to
  // the dashboard. Sign out or the assertion below tests nothing.
  await signOut(page);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(replacement);
  await page.getByRole("button", { name: "Sign in" }).click();

  // No organization yet, so a successful sign-in lands on the chooser.
  await expect(page).toHaveURL(/\/select-org/);
});

test("a display name change is reflected in the session", async ({ page }) => {
  await signIn(page, "admin@acme.test");
  await page.goto("/account");

  const renamed = "Alan Renamed";
  await page.getByLabel("Full name").fill(renamed);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  // The name is part of the session payload, so seeing it in the org sidebar is
  // what proves the cached session was dropped rather than merely invalidated.
  await page.goto("/acme");
  await expect(page.getByText(renamed)).toBeVisible();

  await page.goto("/account");
  await page.getByLabel("Full name").fill("Alan Admin");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
});

test("the reset page refuses to show a form without a session", async ({ page }) => {
  // Someone opening /reset-password directly, or following an expired link, must
  // not be shown a form that cannot work.
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: "This link is no longer valid" })).toBeVisible();
  await expect(page.getByLabel("New password")).toHaveCount(0);
});
