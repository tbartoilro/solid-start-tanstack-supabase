import { expect, type Page } from "@playwright/test";
import path from "node:path";

export const PASSWORD = "password123";

/**
 * Where each role's authenticated cookies are cached by e2e/auth.setup.ts.
 *
 * Lives here rather than in the setup file because Playwright refuses to let one
 * test file import another.
 */
export const STATES = {
  viewer: path.join(import.meta.dirname, ".auth/viewer.json"),
  owner: path.join(import.meta.dirname, ".auth/owner.json"),
} as const;

/** Signs in through the real form, which also proves the page hydrated. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

/**
 * The names of the sidebar navigation links, read from the accessibility tree.
 *
 * The CDP version of this matched substrings against innerHTML, so "Settings"
 * would be found anywhere on the page — including inside a word, or in a
 * hidden element. Asking for links by role is both narrower and more honest
 * about what the assertion means.
 */
export async function navLinks(page: Page): Promise<string[]> {
  const links = page.getByRole("navigation").getByRole("link");
  return (await links.allInnerTexts()).map((t) => t.trim());
}

/**
 * Calls a `"use server"` function the way an attacker would: straight at the
 * endpoint, with the session cookie but no router, no form and no UI.
 *
 * This is the assertion that actually matters for the whole architecture — a
 * route guard stops navigation, not a POST.
 *
 * Importing the module inside the page gets the client stub Vite generates for
 * a server function, so this exercises the real transport without hardcoding
 * the endpoint naming scheme (which is a build-tool implementation detail).
 */
export async function callRpc(
  page: Page,
  module: string,
  fn: string,
  payload: unknown,
): Promise<{ ok: boolean; message: string | null; value: unknown }> {
  return page.evaluate(
    async ({ module, fn, payload }) => {
      try {
        const mod = await import(/* @vite-ignore */ `/src/server/rpc/${module}.ts`);
        const value = await mod[fn](payload);
        return { ok: true, message: null, value };
      } catch (err) {
        const e = err as { message?: string };
        return { ok: false, message: String(e?.message ?? err), value: null };
      }
    },
    { module, fn, payload },
  );
}
