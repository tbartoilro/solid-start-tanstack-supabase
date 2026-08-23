# Phase 5 — Park UI dashboard

Tracking file for the UI conversion. Updated as work lands.

## Setup

- [x] Install `@park-ui/panda-preset`, wire `createPreset` into `panda.config.ts`
- [x] Write `components.json` by hand (`park-ui init` is interactive-only)
- [x] Add 15 Park UI components to `src/components/ui/`
- [x] Resolve the CLI's post-install error (it failed to pull transitive deps; closed the graph manually)
- [x] `styled-system` codegen clean with the preset
- [x] Bridge preset 0.43.1 (Ark anatomy v3) to Ark UI v5 slots/recipes
- [ ] Switch `src/app.tsx` from `app.css` to `panda.css`
- [ ] App shell styling (sidebar, nav, org switcher) on Park UI

## Screens

- [ ] `login` / `signup` / `forgot-password` / `reset-password`
- [ ] `select-org` / `new-org` / `accept-invite`
- [ ] `$orgSlug/` overview (stat tiles, recent issues)
- [ ] `$orgSlug/projects` list + create form
- [ ] `$orgSlug/projects/$projectId` detail
- [ ] `$orgSlug/issues` table, filters, pagination
- [ ] `$orgSlug/members` roles, invites
- [ ] `$orgSlug/settings` + export
- [ ] `$orgSlug/audit` log
- [ ] `account`

## Green before push

- [ ] `npm run typecheck`
- [ ] `npm test` (unit + RLS)
- [ ] `npm run test:e2e` (Playwright)
- [ ] `npm run build`
- [ ] Dark mode renders correctly
- [ ] Keyboard focus visible on all interactive elements
