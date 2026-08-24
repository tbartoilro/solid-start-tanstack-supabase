# Phase 5 — Park UI dashboard

Tracking file for the UI conversion. Updated as work lands.

## Setup

- [x] Install `@park-ui/panda-preset`, wire `createPreset` into `panda.config.ts`
- [x] Write `components.json` by hand (`park-ui init` is interactive-only)
- [x] Add 15 Park UI components to `src/components/ui/`
- [x] Resolve the CLI's post-install error (it failed to pull transitive deps; closed the graph manually)
- [x] `styled-system` codegen clean with the preset
- [x] Bridge preset 0.43.1 (Ark anatomy v3) to Ark UI v5 slots/recipes
- [x] Switch `src/app.tsx` from `app.css` to `panda.css` (+ Vite `styled-system` alias)
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
- [x] Shared list primitives in `src/components/data.tsx`: `TableScroll`,
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
- [x] `e2e/responsive.spec.ts` — 7 routes × 3 viewports assert the document
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
- [x] `e2e/org-switching.spec.ts` — asserts switcher label, heading, every
      sidebar href and the member list, because a URL-only assertion passes
      against the broken build.

Not a security issue: the server was correct throughout and RLS was never
bypassed. The stale links pointed at an organization the user does belong to.

## Notes for later

- The Ark v5 bridge in `panda.config.ts` is temporary. Delete it when
  `@park-ui/panda-preset` ships a build against `@ark-ui/anatomy` v5.
- `@park-ui/cli add` still reports "an unexpected error" and skips transitive
  registry dependencies. Re-run the graph check in the README after adding a
  component.
- Playwright's bundled Chromium cannot run on NixOS; the suite honours
  `CHROMIUM_PATH` (`/run/current-system/sw/bin/chromium` here).
