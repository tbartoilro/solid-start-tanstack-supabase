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
 * Below `md` a table is no longer allowed to scroll at all: `ResponsiveTable`
 * in src/components/data.tsx turns each row into a card, so the columns stack
 * instead of running off the side. From `md` up a table may still scroll, but
 * only inside its own container rather than dragging the document with it.
 * That distinction is exactly what these assertions encode.
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

test.describe("no table scrolls inside its own container, at any width", () => {
  test.use({ storageState: STATES.owner });

  /**
   * The page not overflowing is not the same as the data being reachable.
   * A table can sit inside a container that scrolls sideways: the document
   * stays put, and the last columns are still hidden behind a drag.
   *
   * These widths are the ones that actually broke. From `md` the sidebar takes
   * 16rem, so 768-1023px leaves only 450-700px of content — not enough for a
   * five-column table, which kept its old 44rem floor and scrolled inside its
   * card. 1100px is just above `lg`, where every table is a table again and the
   * audit log's Details column was still wide enough to push past the edge.
   */
  // Four widths, not a sweep: one per distinct behaviour. 390 is the phone
  // card layout, 900 is the band that was broken, 1100 is just above `lg` where
  // the table returns and audit was still too wide, 1440 is comfortable. Adding
  // the intermediate widths quadrupled the runtime and asserted nothing new.
  const WIDTHS = [390, 900, 1100, 1440];
  const TABLES = [
    { name: "issues", path: "/acme/issues?page=1" },
    { name: "members", path: "/acme/members" },
    { name: "projects", path: "/acme/projects" },
    { name: "audit", path: "/acme/audit?page=1" },
  ];

  for (const width of WIDTHS) {
    test(`nothing scrolls sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });

      for (const table of TABLES) {
        await page.goto(table.path);
        await expect(page.getByRole("table")).toBeVisible();

        const result = await page.evaluate(() => {
          const el = document.querySelector("table")!;
          let worst = 0;
          let node: HTMLElement | null = el.parentElement;
          while (node && node !== document.body) {
            worst = Math.max(worst, node.scrollWidth - node.clientWidth);
            node = node.parentElement;
          }
          return {
            container: worst,
            page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });

        expect(result.page, `${table.name} scrolls the page at ${width}px`).toBeLessThanOrEqual(1);
        expect(
          result.container,
          `${table.name} scrolls inside its container at ${width}px — its columns are unreachable without dragging`,
        ).toBeLessThanOrEqual(1);
      }
    });
  }
});

test.describe("tables become cards on a phone", () => {
  test.use({ storageState: STATES.owner });

  /**
   * The previous answer to five columns on a 390px screen was to keep the table
   * wide and scroll it sideways. That kept rows readable but made the data hard
   * to actually use — you could never see a whole record, and with many rows you
   * were scrolling in two axes at once.
   *
   * Below `md` each row is now a card and the off-screen columns stack
   * underneath, labelled. These assertions pin that down from both directions:
   * nothing scrolls sideways on a phone, and the desktop table is untouched.
   */

  test("the issues table does not scroll sideways on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/acme/issues?page=1");
    await expect(page.getByRole("table")).toBeVisible();

    const result = await page.evaluate(() => {
      const table = document.querySelector("table")!;

      // Walk up from the table looking for anything that scrolls horizontally.
      // Previously the wrapper did, by design; now nothing should.
      let scroller: HTMLElement | null = table.parentElement;
      let scrolls = 0;
      while (scroller && scroller !== document.body) {
        scrolls = Math.max(scrolls, scroller.scrollWidth - scroller.clientWidth);
        scroller = scroller.parentElement;
      }

      return {
        scrolls,
        tableWidth: table.getBoundingClientRect().width,
        viewport: document.documentElement.clientWidth,
        headerRowVisible: getComputedStyle(document.querySelector("thead")!).display !== "none",
      };
    });

    expect(result.scrolls, "a table wrapper is still scrolling horizontally").toBeLessThanOrEqual(1);
    // The table must now fit, rather than keeping an oversized minimum width.
    expect(result.tableWidth).toBeLessThanOrEqual(result.viewport);
    // Every value carries its own label in card mode, so the header row is dead
    // weight and is hidden.
    expect(result.headerRowVisible).toBe(false);
  });

  test("stacked cells carry the label their column header used to provide", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/acme/issues?page=1");
    await expect(page.getByRole("table")).toBeVisible();

    // The labels are ::before content, which no text locator can see — reading
    // the computed style is the only way to assert they actually render.
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr:first-child td[data-label]")].map((td) =>
        getComputedStyle(td, "::before").content.replace(/^"|"$/g, ""),
      ),
    );

    expect(labels.length, "no labelled cells found — is data-label missing?").toBeGreaterThan(0);
    expect(labels).toContain("Status");
    for (const label of labels) {
      expect(label, "a labelled cell rendered an empty label").not.toBe("none");
    }
  });

  test("every cell in a card is either labelled, the primary, or an action", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // An unlabelled cell renders as anonymous text in the middle of a card,
    // which is exactly the confusion this layout exists to remove.
    //
    // Project detail is reached by following a link rather than by a literal
    // path: its URL carries a project id, and hard-coding a seeded uuid here
    // would tie this layout assertion to the seed data.
    const paths = ["/acme/issues?page=1", "/acme/members", "/acme/projects", "/acme/audit?page=1"];

    for (const path of [...paths, null]) {
      if (path) {
        await page.goto(path);
      } else {
        await page.goto("/acme/projects");
        await page.getByRole("table").getByRole("link").first().click();
        // Tolerates the search params the link carries — the project detail
        // route declares page/sort/dir, so its links are not bare paths.
        // Anchoring on `$` asserted the absence of a query string, which was
        // never the point: what matters is that the click landed on a project.
        await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}(\?|$)/);
      }
      const where = path ?? "project detail";
      await expect(page.getByRole("table")).toBeVisible();

      const orphans = await page.evaluate(() =>
        [...document.querySelectorAll("tbody td")]
          .filter(
            (td) =>
              !td.hasAttribute("data-label") &&
              !td.hasAttribute("data-primary") &&
              !td.hasAttribute("data-actions") &&
              (td.textContent ?? "").trim() !== "",
          )
          .map((td) => (td.textContent ?? "").trim().slice(0, 40)),
      );

      expect(orphans, `unlabelled cells on ${where}`).toEqual([]);
    }
  });

  test("the desktop table is still a table", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/acme/issues?page=1");
    await expect(page.getByRole("table")).toBeVisible();

    const desktop = await page.evaluate(() => ({
      headerRowVisible: getComputedStyle(document.querySelector("thead")!).display !== "none",
      rowDisplay: getComputedStyle(document.querySelector("tbody tr")!).display,
      // The ::before labels must not leak into the desktop layout.
      firstLabel: getComputedStyle(
        document.querySelector("tbody td[data-label]")!,
        "::before",
      ).content,
    }));

    expect(desktop.headerRowVisible).toBe(true);
    expect(desktop.rowDisplay).toBe("table-row");
    expect(desktop.firstLabel).toBe("none");
  });
});
