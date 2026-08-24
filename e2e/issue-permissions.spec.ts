import { expect, test, type Locator, type Page } from "@playwright/test";
import { STATES, callRpc } from "./helpers";

/**
 * The issue permission matrix, checked where it actually has to hold.
 *
 * `issues.write` gates create, edit and delete; `issues.assign` gates
 * reassignment; status is the exception — the assignee may change it whatever
 * role they hold, because being handed a task carries the right to report on
 * it. That last rule cannot be inferred from a role, so the viewer below is
 * driven through the real control on the real row.
 *
 * Refusals are asserted at the endpoint instead. A hidden button shows the
 * interface is polite; only the endpoint saying no shows the system is safe.
 */

/** Seeded, assigned to viewer@acme.test. See supabase/seed.sql. */
const OWN_ISSUE = "Document pagination cursors";

/** Seeded, assigned to member@acme.test — visible to the viewer, not theirs. */
const OTHERS_ISSUE = "Add dark mode toggle";

/**
 * A row found by its title rather than its `WEB-3` key.
 *
 * Issue numbers are per-project and monotonic, and other suites create issues
 * they never clean up, so a given row's key drifts between runs. The title is
 * the stable handle; the key only appears inside the accessible names, matched
 * by prefix below.
 */
function issueRow(page: Page, title: string): Locator {
  return page.getByRole("row").filter({ hasText: title });
}

/** Ark's Select is a listbox behind a combobox trigger, not a `<select>`. */
async function chooseOption(page: Page, combobox: Locator, option: string): Promise<void> {
  await combobox.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

// Both pickers are named per row — "Status for API-2" — so that a table of them
// stays distinguishable to a screen reader and to a locator.
const statusOf = (row: Locator) => row.getByRole("combobox", { name: /^Status for / });
const assigneeOf = (row: Locator) => row.getByRole("combobox", { name: /^Assignee for / });

/**
 * The id of a seeded issue, read through the API the caller is allowed to use.
 *
 * Doubles as half of each refusal assertion below: the row comes back, so a
 * write that is then refused was refused for lacking the permission and not
 * because the viewer could not see the row in the first place.
 */
async function readableIssueId(page: Page, title: string): Promise<string> {
  const res = await callRpc(page, "issues", "listIssues", { orgSlug: "acme", search: title });
  expect(res.ok).toBe(true);

  const [issue] = (res.value as { issues: { id: string }[] }).issues;
  expect(issue, `no issue titled "${title}" — has the seed changed?`).toBeTruthy();
  return issue!.id;
}

test.describe("viewer", () => {
  test.use({ storageState: STATES.viewer });

  test("can close the issue they are assigned, without issues.write", async ({ page }) => {
    await page.goto("/acme/issues");

    const status = statusOf(issueRow(page, OWN_ISSUE));

    // Two moves, and only the second is the claim: the seed leaves this issue
    // done, so closing it straight away would assert nothing. Ending on "Done"
    // also puts the seeded row back the way it was found.
    await chooseOption(page, status, "In progress");
    await expect(status).toContainText("In progress");

    await chooseOption(page, status, "Done");
    // The picker's value comes from the query cache, which the mutation
    // invalidates rather than patching, so this only reads "Done" once the
    // server has accepted the change and the row has been fetched again.
    await expect(status).toContainText("Done");
  });

  test("is offered no create, edit, delete or reassign controls", async ({ page }) => {
    await page.goto("/acme/issues");

    // The table has to be on screen before anything is counted. Zero controls
    // on a page that has not rendered yet is a pass for the wrong reason.
    await expect(issueRow(page, OWN_ISSUE)).toBeVisible();

    await expect(page.getByRole("button", { name: "New issue" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);
    await expect(assigneeOf(page.getByRole("table"))).toHaveCount(0);
  });

  test("calling setIssueStatus on someone else's issue is refused", async ({ page }) => {
    await page.goto("/acme");

    const res = await callRpc(page, "issues", "setIssueStatus", {
      orgSlug: "acme",
      issueId: await readableIssueId(page, OTHERS_ISSUE),
      status: "cancelled",
    });

    // The row-level half of the rule, which no amount of role checking reaches:
    // the same viewer who may close their own issue may not touch this one.
    //
    // The reason is asserted, not just the failure. A mistyped payload would
    // also come back `ok: false`, and a refusal test that passes because the
    // call never made it past validation is worse than no test at all.
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/cannot change that issue's status/i);
  });

  test("calling deleteIssue directly is refused", async ({ page }) => {
    await page.goto("/acme");

    const res = await callRpc(page, "issues", "deleteIssue", {
      orgSlug: "acme",
      issueId: await readableIssueId(page, OTHERS_ISSUE),
    });

    // `authorize` throws before the handler runs, so a refusal here really does
    // mean nothing reached the database — unlike an RLS-denied DELETE, where a
    // clean status code and an untouched row look the same from outside.
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/issues\.write/);
  });
});

test.describe("owner", () => {
  test.use({ storageState: STATES.owner });

  test("creates, edits, reassigns and deletes an issue through the UI", async ({ page }) => {
    // Its own row, not a seeded one: src/server/rls.integration.test.ts asserts
    // on the seeded counts. The suffix keeps a run that died mid-journey from
    // leaving a title the next run would match twice.
    const title = `Owner journey ${Date.now().toString(36)}`;
    const renamed = `${title} edited`;

    await page.goto("/acme/issues");
    await page.getByRole("button", { name: "New issue" }).click();

    // Only the open dialog is in the accessibility tree; the per-row edit
    // dialogs stay mounted but hidden, so this stays unambiguous.
    const dialog = page.getByRole("dialog");
    const projectPicker = dialog.getByRole("combobox", { name: "Project" });

    await chooseOption(page, projectPicker, "WEB · Web Platform");
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByRole("button", { name: "Create issue" }).click();

    const row = issueRow(page, title);
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: /^Edit / }).click();
    await dialog.getByLabel("Title").fill(renamed);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(row).toContainText(renamed);

    // Separate permission, separate endpoint: `assignIssue`, not `updateIssue`.
    await chooseOption(page, assigneeOf(row), "Vic Viewer");
    await expect(assigneeOf(row)).toContainText("Vic Viewer");

    await row.getByRole("button", { name: /^Delete / }).click();
    await page.getByRole("button", { name: "Delete issue" }).click();
    await expect(row).toHaveCount(0);
  });
});
