import { expect, test } from "@playwright/test";
import { STATES } from "./helpers";

/**
 * Nothing may scroll the *document* sideways.
 *
 * This exists because the failure it guards against is invisible in code review
 * and easy to reintroduce. A CSS grid `1fr` track carries an implicit
 * `min-width: auto`, so a single wide child — a data table, a long URL, an
 * unbroken JSON blob — silently widens the whole column and the entire page
 * starts scrolling horizontally on a phone. It looks fine at desktop width, so
 * only a real viewport catches it.
 *
 * Tables are *expected* to scroll; they just have to do it inside their own
 * container (see TableScroll in src/components/data.tsx) rather than dragging
 * the document with them. That distinction is exactly what these assertions
 * encode.
 */

/** iPhone-class, small tablet, and a laptop. */
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
];

const ROUTES = [
  { name: "overview", path: "/acme" },
  { name: "projects", path: "/acme/projects" },
  { name: "issues", path: "/acme/issues?page=1" },
  { name: "members", path: "/acme/members" },
  { name: "settings", path: "/acme/settings" },
  { name: "audit", path: "/acme/audit?page=1" },
  { name: "account", path: "/account" },
];

test.describe("no horizontal overflow", () => {
  test.use({ storageState: STATES.owner });

  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${route.name} at ${vp.name} (${vp.width}px)`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(route.path);

        // Wait for real content, not just the shell — a page still rendering
        // its loader data cannot overflow yet, so asserting too early passes
        // for the wrong reason. The h1 is the one thing every route has:
        // /account deliberately sits outside the org shell and so has no <nav>.
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

        const overflow = await page.evaluate(() => {
          const de = document.documentElement;
          return {
            by: de.scrollWidth - de.clientWidth,
            // Whatever is actually sticking out, to make a failure diagnosable
            // instead of just a number.
            culprits: [...document.querySelectorAll("main *, aside *")]
              .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 1)
              .slice(0, 3)
              .map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 30)}`),
          };
        });

        expect(
          overflow.by,
          `page scrolls horizontally by ${overflow.by}px; widest: ${overflow.culprits.join(", ")}`,
        ).toBeLessThanOrEqual(1);
      });
    }
  }
});

test.describe("wide tables stay scrollable rather than crushed", () => {
  test.use({ storageState: STATES.owner });

  test("the issues table keeps a readable width and scrolls inside its container", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/acme/issues?page=1");
    await expect(page.getByRole("table")).toBeVisible();

    const result = await page.evaluate(() => {
      const table = document.querySelector("table")!;
      let scroller: HTMLElement | null = table.parentElement;
      while (scroller && scroller.scrollWidth <= scroller.clientWidth) {
        scroller = scroller.parentElement;
      }
      return {
        tableWidth: table.getBoundingClientRect().width,
        scrolls: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
        // The scroller must be inside the page, not the page itself.
        isElement: scroller !== null && scroller !== document.documentElement,
      };
    });

    // Squeezing five columns into 390px is what produced unreadable three-line
    // cells; the table is supposed to stay wide and let the container scroll.
    expect(result.tableWidth).toBeGreaterThan(600);
    expect(result.scrolls).toBeGreaterThan(0);
    expect(result.isElement).toBe(true);
  });
});
