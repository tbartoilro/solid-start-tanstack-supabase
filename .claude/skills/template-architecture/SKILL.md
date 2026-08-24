---
name: template-architecture
description: This skill should be used when orienting in this multi-tenant SolidStart + TanStack Router + Supabase template — first contact with the repo, or questions like "how does this app work", "explain the architecture", "where should this logic go", "where do I put this", "is this secure", "can a user bypass this", "who is allowed to do this", "add a feature", "why is authorization split between the JWT and the database", or "what enforces tenant isolation".
version: 0.1.0
---

# Template architecture

A multi-tenant issue tracker, built as a reference for one question: what logic
belongs on the server, and why. Organizations contain projects; projects contain
issues; a user holds one role per organization; roles map to fine-grained
permissions. That domain was chosen because it forces tenant isolation,
privilege escalation and permission granularity to be answered rather than
dodged.

Read `README.md` for the long-form rationale. This skill is the operating
reference.

## The one rule

A `"use server"` function compiles to a plain HTTP endpoint. Anyone with
devtools can `POST` at it with their session cookie and no router, no form and
no UI in the picture.

Therefore:

- `beforeLoad` guards (`apps/reference/src/routes/_authed.tsx`, `apps/reference/src/routes/_authed/$orgSlug.tsx`)
  are **UX only**. They stop navigation and prevent an auth flash. Delete every
  one of them and the app should look broken but leak nothing.
- `<Can>` (`apps/reference/src/components/Can.tsx`) and `can()` (`apps/reference/src/lib/auth.ts`) decide what
  to **render**. They protect nothing.
- The enforcement that holds is `authorize()` in `apps/reference/src/server/guard.ts`, with RLS
  underneath.

`apps/reference/e2e/rbac.spec.ts` is the proof. Its `callRpc` helper in `apps/reference/e2e/helpers.ts`
`page.evaluate`s an `import("/src/server/rpc/<module>.ts")` inside the browser
and calls the exported function directly — the client stub Vite generates —
so the assertion exercises the real transport with the router bypassed
entirely. Any new privileged endpoint deserves a test there.

## Four layers, one job each

| Layer | Location | Job | Not its job |
|---|---|---|---|
| 1. Middleware | `apps/reference/src/middleware.ts` | Who is asking. Builds the request Supabase client, verifies the token, parses the `orgs` claim, resolves the active org, fills `event.locals`. | Any authorization decision. |
| 2. RPC boundary | `apps/reference/src/server/rpc/*` | The trust boundary. Validate, authorize, translate errors. Thin. | Business rules, SQL. |
| 3. Domain services | `apps/reference/src/server/services/*` | Logic over an explicit `OrgContext`/`AuthContext`. Unit-testable with no server. | Reading cookies, deciding who the caller is. |
| 4. Data + RLS | `apps/reference/supabase/migrations/*` | Queries and the database backstop. | Being the only line of defence. |

Middleware uses `getClaims()`, never `getSession()` — the latter trusts the
cookie without verifying the signature. Note the gotcha documented in the file:
the `event` a middleware receives is the h3 event and has no `locals`; reach
SolidStart's via `getRequestEvent()`.

### Where does this logic go?

1. Needs to know **who is calling**? RPC layer only. Services receive it as an
   argument.
2. Is it **"caller must hold permission X"**? `authorize(permission, schema, raw)`.
3. Authenticated but **pre-membership** (creating an org, accepting an invite)?
   `authenticated(schema, raw)` — validates and rejects anonymous callers, and
   deliberately performs no permission check.
4. Tenant-scoped but the rule **depends on the row** (currently only
   `setIssueStatus`, which the assignee may call without `issues.write`)?
   `withinOrg(schema, raw)` for membership, then a `security definer` database
   function that can see the row. See `apps/reference/supabase/migrations/20260824060000_issue_status_by_assignee.sql`.
5. Would it be a security or integrity bug if an application path forgot it?
   A trigger, not service code. See below.

`authorize()` runs a fixed order — **validate → scope to tenant → authorize →
handle** — so the tenant is resolved from an already-typed value and no domain
code runs for a caller who was not allowed to reach it. Every tenant-scoped
schema extends `orgScoped` (`{ orgSlug }`).

Pagination is clamped in the schema (`.max(100)`, `.catch(25)`), because the
endpoint is public and limits cannot be enforced by the UI that happens to call
it.

## RBAC: JWT for speed, database for truth

- `public.custom_access_token_hook` (`apps/reference/supabase/migrations/20260820120100_rbac.sql`)
  stamps an `orgs` claim of `{id, slug, role}` into every issued token. Only
  membership edges, never the resolved permission set, so a permission change in
  a migration does not leave stale copies in outstanding tokens.
- `private.authorize(permission, org_id)` is the authority. It is reached from
  TypeScript through the `public.has_permission()` wrapper
  (`apps/reference/supabase/migrations/20260820120400_authorize_rpc.sql`, `security invoker` so
  `auth.uid()` resolves to the real caller), and from every RLS policy directly.
- `requirePermission()` in `apps/reference/src/server/context.ts` calls `has_permission` and is
  what `authorize()` uses. It deliberately does **not** read `ctx.role`.

**The claim is a cache and it goes stale.** Revoking a role does not invalidate
issued tokens, so a demoted user keeps the old claim until refresh. A stale
claim may decide what to render; it must never decide whether a write succeeds.
`requireOrg()` reads the claim only to pick a *scope* — a stale org yields a
context whose every query RLS refuses.

Permissions are read from the `role_permissions` table (`getSession` in
`apps/reference/src/server/rpc/auth.ts`), never mirrored in TypeScript, so the UI cannot
disagree with the database. `AppRole`/`AppPermission` in `apps/reference/src/lib/auth.ts` are
derived from `apps/reference/src/lib/database.types.ts`, so adding an enum value in a migration
and forgetting the frontend is a type error. Regenerate with `npm run db:types`.

Helper functions live in the `private` schema, which is not in PostgREST's
exposed schema list — *that*, not privilege revocation, is what stops clients
calling them. `authenticated` must keep `USAGE`/`EXECUTE` there, because an RLS
policy expression is evaluated with the querying role's privileges.

RLS policies (`apps/reference/supabase/migrations/20260820120200_rls.sql`) wrap every helper
call in `(select ...)` so Postgres evaluates it once per statement as an
InitPlan rather than per row, and index every policy-referenced column.

## Invariants live in the database

`apps/reference/supabase/migrations/20260820120300_triggers.sql`, all `security definer` with
`set search_path = ''`:

- `on_auth_user_created` → `public.handle_new_user()`: profile row on signup, so
  every signup path is covered, not just the implemented ones.
- `organizations_add_owner` → `private.org_add_owner()`: the founder becomes
  owner. Without it the creator is locked out, since every other policy is
  membership-derived.
- `issues_assign_number` → `private.assign_issue_number()`: per-project `PROJ-1`
  numbering under `pg_advisory_xact_lock`. The unique `(project_id, number)`
  constraint is still the real guarantee.
- `memberships_protect_last_owner` → `private.protect_last_owner()`: an org must
  retain one owner or it becomes permanently unadministrable.
- `memberships_audit` / `projects_audit`: audit writes. **`audit_log` has no
  INSERT policy at all**, so the trigger is the only way an entry can exist —
  history cannot be forged or rewritten, including by an owner.

Escalation is guarded in the service layer too: `assertCanAssignRole()` in
`apps/reference/src/server/services/members.ts` stops an admin — who legitimately holds
`members.manage` — from minting an owner.

## Error and leak discipline

`apps/reference/src/server/errors.ts`: an unauthorized *tenant read* returns **404, not 403**.
A 403 confirms the resource exists, which lets one tenant map another's data by
probing ids. Use `forbidden()` only when the caller provably already knows the
resource exists — e.g. lacking a permission inside an org they belong to.

`apps/reference/src/server/on-error.ts` (wired via `serverFunctions.onError` in
`vite.config.ts`) is the last gate: deliberate `AppError`s pass through, `Response`
(thrown redirects) passes through, everything else is logged in full server-side
and replaced with a generic message.

Services treat "zero rows affected" as denial: RLS turns an unauthorized UPDATE
into no matched rows rather than an error, so `if (!data?.length) throw notFound(...)`
is load-bearing, not defensive noise.

## SSR seam, in one paragraph

`createHandler`'s third argument (`routerLoad` in `apps/reference/src/entry-server.tsx`) runs
after middleware and before render, so loaders resolve into the first byte of
HTML. Loader data transfer is **not** automatic: TanStack Query is the vehicle —
loaders go through `ensureQueryData` with definitions shared from
`apps/reference/src/lib/queries.ts`, the server inlines the dehydrated cache as
`#__QUERY_STATE__`, and the client rehydrates before mounting
(`apps/reference/src/router.tsx`). A loader and its component must use the same query
definition or the client refetches on hydration. `apps/reference/e2e/ssr.spec.ts` guards the
seam: loader data present in the raw server HTML, zero `/_server` requests on a
fully-rendered page, and no console error or warning across three navigations —
a SolidStart hydration mismatch surfaces as a warning and nothing else, so it
fails silently if nobody watches.

`apps/reference/src/api/**` is SolidStart's filesystem router (HTTP endpoints, no `/api`
prefix); `apps/reference/src/routes/**` is entirely TanStack Router's.

## Verify

```
npm run typecheck
npm test          # unit + RLS asserted straight against PostgREST, app not running
npm run test:e2e  # needs the local stack: npm run db:start
npm run verify    # all three
```

RLS tests skip themselves when the stack is unreachable and CI fails on skips.
Local skips mean the database is down, not that things are fine.

## Sibling skills

Read the matching one before starting that task rather than working it out from
this overview:

| Skill | For |
|---|---|
| `add-permission` | a new `app_permission`, changing what a role may do, escalation rules |
| `add-tenant-resource` | a new tenant-owned table, end to end: migration → RLS → service → RPC → screen |
| `solidstart-tanstack-seam` | routes, loaders, SSR, hydration, the reactivity and two-cache rules |
| `park-ui-conventions` | any UI work — the responsive table contract, portals, layout traps |
| `testing-and-verification` | running or writing tests, and the environment traps around them |

## Deliberately absent

Billing (only the `org.billing` permission seam exists), soft deletes, realtime,
i18n, cross-tenant superadmin, file storage. Data export *is* present:
`exportOrganization` in `apps/reference/src/server/rpc/org.ts`, gated on `org.export`. Do not
describe any of the absent items as supported.
