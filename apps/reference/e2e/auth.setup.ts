import { test as setup } from "@playwright/test";
import { STATES, signIn } from "./helpers";

/**
 * Authenticates each seeded role once and saves the cookies for reuse.
 *
 * Not just an optimisation. src/server/rpc/auth.ts rate-limits sign-in to 5
 * attempts per address per 15 minutes — deliberately, as credential-stuffing
 * defence — so a suite that logs in afresh for every test throttles itself and
 * fails with spurious "still on /login" errors. Signing in once per role and
 * replaying the session is both faster and a truer reflection of how a real
 * client behaves.
 */

setup("authenticate viewer", async ({ page }) => {
  await signIn(page, "viewer@acme.test");
  await page.context().storageState({ path: STATES.viewer });
});

setup("authenticate owner", async ({ page }) => {
  await signIn(page, "owner@acme.test");
  await page.context().storageState({ path: STATES.owner });
});
