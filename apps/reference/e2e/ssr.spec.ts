import { expect, test } from "@playwright/test";
import { STATES, signIn } from "./helpers";

/**
 * The SSR / hydration seam — the thing Phase 0 of this repo exists to prove.
 *
 * Ported from scripts/verify-ssr.mjs. The console assertion is the valuable one:
 * a hydration mismatch in SolidStart surfaces as a warning and nothing else, so
 * without watching the console it fails completely silently.
 */

test.describe("with an existing session", () => {
  test.use({ storageState: STATES.owner });

  test("authenticated loader data is present in the server response", async ({ request, page }) => {
    await page.goto("/acme");

    // Replay the request server-side with the session cookies, so no client
    // JavaScript is involved in producing the HTML being asserted on.
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const res = await request.get("/acme", { headers: { cookie: cookieHeader } });
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("Acme Corporation");
  });

  test("hydration reuses the server's data instead of refetching it", async ({ page }) => {
    // Every server function goes out as a POST to SolidStart's `/_server`
    // endpoint, whatever the build names the individual handler, so counting
    // those is a naming-scheme-independent way to see the loaders run.
    const calls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/_server")) calls.push(`${req.method()} ${req.url()}`);
    });

    await page.goto("/acme");

    // The nav is rendered by the org shell, whose `beforeLoad` needs both the
    // session and the org — so once it is on screen, every loader on this route
    // has resolved. Counting before that point would pass because nothing had
    // happened yet.
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Acme Corporation" })).toBeVisible();

    // This is the whole point of `<QueryState />` and `hydrateQueryState()`.
    // Without them the page still works and still looks right — it just fetches
    // everything a second time, which nothing else in this suite would notice.
    expect(calls).toEqual([]);
  });

  test("no hydration mismatch warnings while navigating", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        problems.push(`${msg.type()}: ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));

    await page.goto("/acme");
    await page.goto("/acme/projects");
    await page.goto("/acme/issues?page=1");
    await expect(page.getByRole("navigation")).toBeVisible();

    expect(problems).toEqual([]);
  });
});

test.describe("from a cold, signed-out browser", () => {
  // Explicitly no stored session: submitting the login form is the assertion,
  // and a replayed cookie would skip the very thing being tested.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signing in through the form proves the page hydrated", async ({ page }) => {
    // A non-hydrated page cannot submit this form at all, so arriving anywhere
    // other than /login is itself the proof.
    await signIn(page, "member@acme.test");
    await expect(page).toHaveURL(/\/acme$/);
  });
});
