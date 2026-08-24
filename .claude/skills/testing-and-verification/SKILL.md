---
name: testing-and-verification
description: This skill should be used when running, writing, or debugging tests in this template — "run the tests", "npm run verify", "add a test", "the tests fail", "why is CI red", "playwright", "vitest", "how do I check this works", "verify this permission is enforced", "why is my table scrolling", "test says element not found", "Vite environment ssr is unavailable", "tests were skipped", "chromium won't launch". Covers which suite proves what, the callRpc direct-endpoint pattern for permission refusals, assertion rules, and the environment traps (NixOS Chromium, .env.test precedence, seed-dependent assertions, editing files mid-run).
version: 0.1.0
---

# Testing and verification

## The suites

```bash
npm run verify     # typecheck && vitest run && playwright test — the gate
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run test:e2e   # playwright test
```

Prerequisite for everything except the pure-logic tests: `npm run db:start`.

| Suite | Files | The claim only it can make |
|---|---|---|
| Vitest, pure | `apps/reference/src/lib/auth.test.ts`, `apps/reference/src/lib/slug.test.ts`, `apps/reference/src/server/services/members.test.ts`, `apps/reference/src/server/env.test.ts`, `apps/reference/src/server/email.test.ts` | Policy is decidable without a server. The role-escalation matrix is asserted for **every** actor/target pair, and `can()` is asserted to scope permissions per org rather than globally. |
| Vitest, integration | `apps/reference/src/server/rls.integration.test.ts` | Tenant isolation holds **with the application switched off entirely**. Nothing in that file imports app code or starts a server; it signs in against GoTrue and hits PostgREST with a real user's token. If it passes, the app layer could be bypassed and the data would still hold. No browser test can say that. |
| Playwright | `apps/reference/e2e/*.spec.ts` | The app: role-aware UI, hydration, onboarding, org switching, responsive layout, and RPC endpoints called directly. |

`vitest.config.ts` deliberately omits the SolidStart plugin. It sets
`SUPABASE_SECRET_KEY` in `test.env` only because `apps/reference/src/server/env.ts` validates at
module load; nothing under vitest reaches the network except the RLS file.

## callRpc — how a refusal is actually proven

`apps/reference/e2e/helpers.ts` exports `callRpc(page, module, fn, payload)`. Inside the page it
does `await import("/src/server/rpc/<module>.ts")` and calls the export directly.
Vite serves the **client stub** for a `"use server"` function, so this exercises
the real transport with the session cookie and no router, no form, no UI.

```ts
const res = await callRpc(page, "projects", "createProject", {
  orgSlug: "acme", name: "Bypassed the UI", key: "HACK",
});
expect(res.ok).toBe(false);
```

Use it for **every** refusal case. A route guard stops navigation, not a POST; a
hidden button shows the interface is polite, not that the system is safe. Modules
available are the files in `apps/reference/src/server/rpc/` (`auth`, `invitations`, `issues`,
`members`, `org`, `profile`, `projects`).

Reserve full UI journeys for happy paths. `apps/reference/e2e/issue-permissions.spec.ts` is the
model: one owner journey drives create/edit/reassign/delete through the real
dialogs, and all four viewer refusals are `callRpc` one-liners.

Two ways a refusal test passes for the wrong reason, both guarded in
`apps/reference/e2e/issue-permissions.spec.ts`:

- **Refused for invisibility, not for permission.** Prove the row is readable
  first — `readableIssueId()` fetches it through an endpoint the caller *is*
  allowed to use, then feeds that id to the write.
- **Refused by input validation.** A mistyped payload also returns `ok: false`.
  Assert the reason: `expect(res.message).toMatch(/issues\.write/)` for an
  `authorize` refusal, or the handler's own wording for a row-level rule.

## Assertion rules

1. **Assert on rendered state, not just the URL.** The org switcher was once
   broken such that the URL changed while every screen kept rendering the
   previous tenant — stale `Route.useRouteContext()` reads. Every test passed.
   `apps/reference/e2e/org-switching.spec.ts` now asserts the switcher label, the `h1`, that
   every `aside nav a` href contains the new slug, and that the members table
   contains the expected user.
2. **Wait for real content before counting absences.** `expect(...).toHaveCount(0)`
   on a page that has not rendered is a pass for the wrong reason. `navLinks()`
   in `apps/reference/e2e/helpers.ts` waits for the first link precisely because
   `allInnerTexts()` does not auto-wait and returns `[]`.
3. **Query the accessibility tree**, not innerHTML substrings. That is why the
   hand-rolled CDP drivers were replaced.
4. **Status codes are not assertions for RLS writes.** An unauthorized DELETE
   under RLS is "no rows matched", which looks identical to success. Read the row
   back with a role that can see it. See the "a member cannot delete a project"
   and "a member cannot promote themselves to owner" cases in
   `apps/reference/src/server/rls.integration.test.ts`.

## Responsive: two distinct claims

`apps/reference/e2e/responsive.spec.ts` asserts both, and they are not the same thing:

- The **document** never scrolls sideways (`documentElement.scrollWidth -
  clientWidth <= 1`) across 390/768/1280 and seven routes. A CSS grid `1fr` track
  carries an implicit `min-width: auto`, so one wide child silently widens the
  whole column.
- No **table** scrolls inside its own container at 390/900/1100/1440. The page can
  sit still while the last columns hide behind a drag — that is the one users
  feel. 900px is the band that broke (sidebar takes 16rem from `md`); 1100 is just
  above `lg` where the audit Details column still overflowed.

Below `lg`, `ResponsiveTable` in `apps/reference/src/components/data.tsx` turns rows into cards:
`thead` is hidden and each `td` carries `data-label`, `data-primary` or
`data-actions`. An unlabelled non-empty `td` fails the "every cell in a card"
test. The labels are `::before` content — no text locator can see them, so those
assertions read `getComputedStyle(td, "::before").content`.

## Environment traps, by symptom

**Chromium will not launch (NixOS).** Playwright's bundled builds are generic
Linux binaries. `playwright.config.ts` reads `use.launchOptions.executablePath`
from `CHROMIUM_PATH`. `shell.nix` sets it and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
Outside the nix shell: `CHROMIUM_PATH=/run/current-system/sw/bin/chromium npm run test:e2e`.
(The config's comment mentions `channel: "chromium"`; the config does not set
`channel` — `CHROMIUM_PATH` is the whole mechanism.)

**A password-reset test fails on a missing heading.** Env precedence. The
Playwright `webServer` runs `npx vite dev --mode test --port 3010 --host 127.0.0.1`
so that committed `.env.test` sets `PUBLIC_APP_URL=http://127.0.0.1:3010`. Passing
it inline instead works in CI (no `.env`, shell value is the only source) and
silently fails locally (Vite loads `.env` into the SSR worker and the shell value
is lost). The link is then minted for `:4321` while the browser is on `:3010`, the
PKCE verifier cookie is on the wrong origin, and the exchange fails. Never move
`PUBLIC_APP_URL` back inline. `--host 127.0.0.1` is also load-bearing: Vite
otherwise binds `[::1]` only and the readiness probe never connects.

**RLS tests fail after you clicked around.** They assert exact seed contents —
`["Public API", "Web Platform"]`, `ACME_PROJECTS = 2`, the owner belonging to
exactly one org, seeded uuids from `apps/reference/supabase/seed.sql`. Fix with `npm run db:reset`.
CI is unaffected: it boots a fresh Supabase and runs vitest **before** Playwright.
This is why e2e tests that create data must create their own (`Owner journey
${Date.now().toString(36)}` in `apps/reference/e2e/issue-permissions.spec.ts`) and why
`apps/reference/e2e/org-switching.spec.ts` signs up a fresh user rather than giving a seeded one
a second org.

**HTTP 503 "Vite environment \"ssr\" is unavailable".** Thrown by
`node_modules/nitro/dist/runtime/internal/vite/dev-worker.mjs`. You edited a file
while a suite was running; the watcher restarted the SSR environment mid-test. Do
not edit during a run. Re-run before believing the failure.

**Tests "passed" but nothing ran.** `rls.integration.test.ts` uses
`describe.skipIf(!stackUp)` — the stack was down. It reports *skipped*, never
green, on purpose: an earlier version guarded with `if (!stackUp) return` and
reported a full green suite against no database. CI parses the vitest JSON report
and fails on any `pending`/`skipped`/`todo`.

**Spurious "still on /login".** `apps/reference/src/server/rpc/auth.ts` rate-limits sign-in to 5
attempts per address per 15 minutes. `apps/reference/e2e/auth.setup.ts` signs in `viewer@acme.test`
and `owner@acme.test` once and saves storage state to `STATES` in `apps/reference/e2e/helpers.ts`.
Use `test.use({ storageState: STATES.owner })`; do not call `signIn()` per test
unless the test *is* about signing in (`apps/reference/e2e/ssr.spec.ts`, `apps/reference/e2e/account.spec.ts`,
which need a fresh or dedicated account because changing a password invalidates
sessions).

**A suite fails oddly against stale code.** Vite moves to the next free port when
3010 is taken, so an orphaned server serves a previous build:
`ps -eo pid,args | grep "[v]ite dev"`. `reuseExistingServer` is on locally.

## Rules

- New permission or refusal path → a `callRpc` case, not only a hidden-control
  assertion. The hidden control is worth asserting too, but it proves nothing
  about safety.
- New table or route → add it to the `ROUTES`/`TABLES` arrays in
  `apps/reference/e2e/responsive.spec.ts`. Add widths only for a distinct behaviour; the comment
  there records that intermediate widths quadrupled runtime and asserted nothing.
- Anything a test creates in the seeded `acme` org must be uniquely named and
  cleaned up, or it drifts the counts the RLS suite asserts. Issue numbers are
  per-project and monotonic, so locate rows by title, never by key like `WEB-3`.
- Never weaken an assertion to make a suite green. A skipped or silently-passing
  test is worse than no test — that is the reasoning behind the CI skip gate.
- Seeded accounts (`apps/reference/supabase/seed.sql`): `owner@`, `admin@`, `member@`,
  `viewer@acme.test`, `outsider@globex.test`, all with `PASSWORD` from
  `apps/reference/e2e/helpers.ts`. Globex exists so isolation is testable — do not give an Acme
  user a Globex membership.

Not present: no component/unit tests for Solid components, no visual regression
or screenshot diffing, no coverage thresholds, no test against a production build
(the e2e suite runs `vite dev` on purpose, because `callRpc` imports server
modules by source path).
