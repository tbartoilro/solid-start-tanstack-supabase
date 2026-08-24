# Phase 5 — Park UI dashboard

Tracking file for the UI conversion. Updated as work lands.

## Setup

- [x] Install `@park-ui/panda-preset`, wire `createPreset` into `panda.config.ts`
- [x] Write `components.json` by hand (`park-ui init` is interactive-only)
- [x] Add 15 Park UI components to `apps/reference/src/components/ui/`
- [x] Resolve the CLI's post-install error (it failed to pull transitive deps; closed the graph manually)
- [x] `styled-system` codegen clean with the preset
- [x] Bridge preset 0.43.1 (Ark anatomy v3) to Ark UI v5 slots/recipes
- [x] Switch `apps/reference/src/app.tsx` from `app.css` to `panda.css` (+ Vite `styled-system` alias)
- [x] App shell (sidebar, permission-filtered nav, org-switcher Menu)

## Screens

- [x] `login` / `signup` / `forgot-password` / `reset-password`
- [x] `select-org` / `new-org` / `accept-invite`
- [x] `$orgSlug/` overview (stat tiles, recent issues)
- [x] `$orgSlug/projects` list + create form
- [x] `$orgSlug/projects/$projectId` detail
- [x] `$orgSlug/issues` table, filters, pagination (Park UI Select + Checkbox)
- [x] `$orgSlug/members` roles, invites
- [x] `$orgSlug/settings` + export
- [x] `$orgSlug/audit` log
- [x] `account`
- [x] `__root` error + not-found screens
- [x] Delete `app.css` (no legacy classes left anywhere)

## Green before push

- [x] `npm run typecheck`
- [x] `npm test` (unit + RLS) — 65 passing
- [x] `npm run test:e2e` (Playwright) — 30 passing
- [x] `npm run build`
- [x] Document `<title>` (static in SSR head + `<PageTitle>` helper)
- [x] Dark mode renders correctly (class-based, pre-paint boot script, toggle)
- [x] Keyboard focus visible (Park UI ships `:focus-visible` rings)

## UI polish (round 2)

Reported: filter/list components asymmetrical and oversized, poor on mobile,
delete dialog text right-aligned.

- [x] Delete dialog text right-aligned — Ark renders the dialog *inline at the
      trigger*, which was a `<td textAlign="right">`, so it inherited the
      alignment. Portalled to `<body>`; also fixes clipping inside scroll
      containers. Same fix applied to the sidebar Menu.
- [x] Page scrolled horizontally at 390px — a grid `1fr` track carries an
      implicit `min-width: auto`, so a wide table widened the column instead of
      scrolling inside it. Now `minmax(0, 1fr)` + `minW="0"` on the content column.
- [x] Sidebar had ~170px of dead space on mobile — grid's default
      `align-content: stretch` was splitting leftover `100dvh` across both rows.
      Content row is now `1fr`.
- [x] Sidebar consumed the whole first screen on mobile — one element, two
      layouts: sticky top bar below `md`, left column from `md`. Deliberately
      NOT two rendered variants, which would put two `<nav>`s and two "Sign out"
      buttons in the tree and break both a11y and the e2e locators.
- [x] Shared list primitives in `apps/reference/src/components/data.tsx`: `TableScroll`,
      `FilterBar`, `Pagination`, `CreateBar`
- [x] Stat tiles compact, three across on a phone
- [x] Five list screens migrated onto the primitives (issues, members, projects,
      project detail, audit) — all tables `size="sm"` inside `TableScroll`
- [x] Consistency + overflow review, which caught two things worth keeping:
      - audit's pagination rebuilt the search object instead of spreading it,
        which would silently drop filters the moment one is added
      - `truncate` does nothing inside a table cell: auto layout grows the
        column to the widest cell, so the cap must be a max-width on an element
        *inside* the cell
- [x] `apps/reference/e2e/responsive.spec.ts` — 7 routes × 3 viewports assert the document
      never scrolls sideways, plus one test that the issues table stays wide and
      scrolls *inside* its container. 24 passing.
- [x] Fixed a pre-existing e2e failure this surfaced (present on committed HEAD
      too, confirmed by stashing): the password-recovery test depended on
      `PUBLIC_APP_URL` being passed inline to the test server, which CI honours
      and a local `.env` silently overrides. Now `.env.test` + `--mode test`.
- [x] Re-verify: typecheck clean, 65 unit, 56 e2e, build clean

## Organization switching (reported bug)

Selecting a second organization navigated to it but the switcher kept showing
the first, you could not switch back, and links followed from the second org's
dashboard showed the first org's data.

- [x] One root cause: `Route.useRouteContext()` returns a signal, and ten route
      files did `const { org } = Route.useRouteContext()()` — calling the
      accessor once at setup and destructuring the result, which snapshots it.
      A route component does not remount when only a param changes, so every
      reader stayed pinned to the previous tenant.
- [x] Fixed in all ten files by reading through accessors. `beforeLoad` left
      alone deliberately — the context it receives is a plain object, and a call
      there fails at runtime, not compile time.
- [x] Caught by review, not by the compiler: `<Show when={session}>` with an
      uncalled accessor is always truthy, so the reset-password form would have
      rendered with no session.
- [x] `apps/reference/e2e/org-switching.spec.ts` — asserts switcher label, heading, every
      sidebar href and the member list, because a URL-only assertion passes
      against the broken build.

Not a security issue: the server was correct throughout and RLS was never
bypassed. The stale links pointed at an organization the user does belong to.

## Tables as cards on mobile (reported)

Internal horizontal scrolling was a poor way to read records on a phone — you
could never see a whole row, and with many rows you scrolled in two axes.

- [x] `ResponsiveTable` in `apps/reference/src/components/data.tsx`: below `md` each row is a
      card and the off-screen columns stack underneath, labelled. From `md` up
      it is an ordinary table.
- [x] Cells declare their card role: `data-label`, `data-label data-block`
      (long values), `data-primary` (identifying, ordered first), `data-actions`
      (ordered last).
- [x] Rows are flex columns on mobile so `order` can lift the identifying cell
      without reordering the desktop columns.
- [x] ARIA roles stated in `apps/reference/src/components/ui/table.tsx`. Changing a table
      element's `display` strips its *implicit* role in every major browser, so
      without this the tables stop being tables to a screen reader and
      `getByRole("table")` stops matching.
- [x] Rejected: rendering a separate mobile card list. Two DOM trees means two
      Delete buttons and two Selects — the duplicate-control trap already hit
      with the nav and Sign out button.
- [ ] All five tables converted
- [ ] `apps/reference/e2e/responsive.spec.ts` rewritten — it previously asserted the *opposite*
      contract (table stays wide and scrolls)
- [ ] Re-verify and visual check at 390 / 768 / 1440

## Fixed — dropdown options unclickable

- [x] The first options in any Select were hard to click and looked squashed.
      Not a min-width problem: Park UI's ItemIndicator renders a bare
      `<svg aria-hidden="true" />` as the placeholder on unselected rows, with
      no width or height. An unsized inline SVG falls back to the CSS default
      300x150, so inside a 36px option it sprawled over the rows above and, being
      hit-testable, swallowed their clicks. Measured 262x150 before, 14x14 after.
      Affected every Select in the app, not just the project filter.

## Done — issue permissions were unreachable from the UI

- [x] Nobody could create, edit, delete, reassign or restatus an issue on any
      screen, so `issues.write` and `issues.assign` existed only in the
      database. Both issue tables now share `apps/reference/src/components/IssueControls.tsx`,
      so the rule for who sees what is written once rather than twice.
- [x] The status picker is offered to an issue's assignee whatever role they
      hold — being handed a task carries the right to report on it. Enforced by
      `public.set_issue_status`, not by the gate that hides the control.
- [x] `apps/reference/e2e/issue-permissions.spec.ts` drives the viewer through the real control
      for the row-dependent rule and asserts every refusal at the endpoint, on
      the message as well as the failure.

## Done — pagination was inert

- [x] Projects and members fetched every row and rendered all of them, so
      Previous/Next had nothing to page through and sat permanently disabled.
      Both now page server-side with `{ count: "exact" }`, with the page number
      in the URL so a list is linkable.
- [x] `pageSize` is clamped at the RPC boundary. These are public endpoints; a
      limit the UI happens to respect is not a limit.
- [x] Assignee pickers use `listAllMembers`, not page one of the roster — a
      paged picker silently makes everyone past 25 unassignable.

## Done — the plugin

- [x] Six skills under `skills/`, so another Claude instance can work on this
      template without rediscovering it. Every cited path, symbol, migration and
      npm script was checked to exist.
- [x] Review pass fixed a contradiction between skills (card breakpoint is
      `lg`, not `md`) and a rule that would have broken working code (a Select
      inside a Dialog must NOT be portalled, or it lands outside the focus trap).

## Fixed — organizations could never be deleted

- [x] `protect_last_owner` and both audit triggers fire on rows that vanish as a
      cascade from the parent, and all three treated a teardown as an ordinary
      edit. `delete from organizations` always failed, so the
      "orgs: owner can delete" policy advertised something the schema refused.
      Found while making the demo loader idempotent. Regression test verified to
      fail against the old triggers.

## Done — data at volume

- [x] `npm run db:demo` loads Northwind Trading: 68 people, 44 projects, 714
      issues. A separate tenant, because the seed is also a test fixture that
      several suites assert exact counts against.

## Fixed — a test asserting the wrong thing

- [x] `org-switching.spec.ts` anchored a URL check with `$`, which quietly made
      it an assertion that no query string was present. Paging members put
      `?page=1` on the sidebar link and it failed. The path is still matched
      exactly, up to the query string.

## Notes for later

- The Ark v5 bridge in `panda.config.ts` is temporary. Delete it when
  `@park-ui/panda-preset` ships a build against `@ark-ui/anatomy` v5.
- `@park-ui/cli add` still reports "an unexpected error" and skips transitive
  registry dependencies. Re-run the graph check in the README after adding a
  component.
- Playwright's bundled Chromium cannot run on NixOS; the suite honours
  `CHROMIUM_PATH` (`/run/current-system/sw/bin/chromium` here).
- Page 1 is spelled `?page=1` in the URL rather than left implicit. Harmless,
  but it means URL assertions must not anchor on `$`.
- `npm run db:demo` needs Docker: the Supabase CLI's `db query` runs a prepared
  statement and so takes one command only, which a multi-statement load is not.
  It goes through `psql` inside the database container instead.
