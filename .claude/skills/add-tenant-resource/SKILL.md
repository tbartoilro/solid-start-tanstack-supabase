---
name: add-tenant-resource
description: This skill should be used when adding a new tenant-owned entity to this template — "add a table", "new model", "add a feature", "create a CRUD screen", "add an entity", "where do I put this logic", "why does my insert return no rows", "why is my new table empty for everyone" — covering the whole slice from migration and RLS policy through service, RPC, query, route and paginated table.
version: 0.1.0
---

# Adding a tenant-owned resource

The worked example is `projects`. Read these before writing anything; the rest
of this file describes what they already do.

- `apps/reference/src/server/services/projects.ts` — domain logic
- `apps/reference/src/server/rpc/projects.ts` — the HTTP boundary
- `apps/reference/src/routes/_authed/$orgSlug/projects/index.tsx` — the screen

Eight steps. Skipping one leaves a resource that either does not compile or is
not protected.

## 1. Migration: the table

New file in `apps/reference/supabase/migrations/`, named `YYYYMMDDHHMMSS_<thing>.sql`. Model it
on `projects` in `apps/reference/supabase/migrations/20260820120000_schema.sql`.

```sql
create table public.widgets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 120),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

**`org_id` goes on every tenant table directly, even when it is derivable.**
`issues` carries `org_id` although it could be reached through `project_id`.
RLS is evaluated per row: a policy that joins to find the tenant costs a join
per row; one that reads a local indexed column costs nothing. This is the most
important rule here and the hardest to walk back later.

Uniqueness that means "unique per customer" must include `org_id` —
`unique (org_id, key)` on projects, never `unique (key)`.

Add the `updated_at` trigger; the function already exists in
`apps/reference/supabase/migrations/20260820120300_triggers.sql`:

```sql
create trigger widgets_set_updated_at
  before update on public.widgets
  for each row execute function private.set_updated_at();
```

For an audit trail, copy `private.audit_project()` from that same migration. It
must be `security definer`: `audit_log` has no INSERT policy at all, so a
trigger is the only thing that can write one — which is precisely why history
cannot be forged, even by an owner.

## 2. Migration: RLS, indexes, grants

Follow `apps/reference/supabase/migrations/20260820120200_rls.sql`. Four things, all required.

```sql
alter table public.widgets enable row level security;

create index widgets_org_id_idx on public.widgets (org_id);

create policy "widgets: read"
  on public.widgets for select
  to authenticated
  using ((select private.authorize('widgets.read', org_id)));

create policy "widgets: write can insert"
  on public.widgets for insert
  to authenticated
  with check ((select private.authorize('widgets.write', org_id)));
-- ...one policy per operation you intend to allow. No policy means no access.

grant select, insert, update, delete on public.widgets to authenticated;
revoke all on public.widgets from anon;
```

- **Wrap every helper call in `(select ...)`.** `(select private.authorize(...))`
  is evaluated once per statement as an InitPlan; the bare call runs once per
  row. On a table of any size that is the difference between a scan and a
  timeout. Same for `(select auth.uid())`.
- **Index every column a policy references.** These indexes live in the RLS
  migration beside the policies that need them, not in the schema migration.
- **Grant, then narrow.** RLS grants nothing — a table with perfect policies and
  no `GRANT` is permission-denied for everyone. `anon` gets nothing, and the
  revoke is written out explicitly for every tenant table rather than trusting
  defaults.
- One policy per operation, as the existing migration does. `for all` forces
  SELECT and DELETE to share an expression you will later need to differ.

New `app_permission` values are a separate job: an enum value cannot be added
and used in the same transaction, which is why
`apps/reference/supabase/migrations/20260821100000_saas_seams.sql` and its `_grants` follow-up
are two files. Reuse an existing permission unless the resource really has its
own authority.

## 3. Apply and regenerate types

```bash
npm run db:reset     # re-runs every migration plus apps/reference/supabase/seed.sql
npm run db:types     # rewrites apps/reference/src/lib/database.types.ts
```

Skip `db:types` and `ctx.db.from("widgets")` is a type error with every column
typed `never`. Not optional.

## 4. Service — `apps/reference/src/server/services/widgets.ts`

Pure functions taking an explicit `OrgContext` (`apps/reference/src/server/context.ts`). No
`getRequestEvent()`, no permission checks, no HTTP — that is what makes them
unit-testable and keeps "who is asking" in one place.

```ts
import type { OrgContext } from "../context";
import { notFound } from "../errors";

export async function updateWidget(ctx: OrgContext, input: UpdateWidgetInput): Promise<void> {
  const { data, error } = await ctx.db
    .from("widgets")
    .update(patch)
    .eq("org_id", ctx.orgId)
    .eq("id", input.widgetId)
    .select("id");

  if (error) throw new Error(`updateWidget: ${error.message}`);
  if (!data?.length) throw notFound("That widget does not exist.");
}
```

Two load-bearing rules:

- **Filter by `org_id` as well as relying on RLS, never instead of it.** The
  explicit filter keeps the planner honest and the intent readable; RLS is what
  makes it safe.
- **Zero matched rows is the not-found signal.** RLS turns an unauthorised
  UPDATE or DELETE into *nothing happened*, not an error. Every mutation must
  `.select("id")` and check the array, or a forbidden write reports success.
  Reads do the same with `.maybeSingle()` plus a null check — see `getProject`.

Map Postgres codes where the user should see something specific:
`createProject` turns `23505` into `conflict(...)` so the message says the key
is taken instead of leaking a constraint name.

## 5. RPC — `apps/reference/src/server/rpc/widgets.ts`

Starts with `"use server"`. Every export is a public HTTP endpoint. Thin:
validate, authorize, delegate.

```ts
const listSchema = orgScoped.extend({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25),
});

export async function listWidgets(input: unknown) {
  const { input: data, ctx } = await authorize("widgets.read", listSchema, input);
  return widgets.listWidgets(ctx, data);
}
```

`authorize()` in `apps/reference/src/server/guard.ts` runs validate → scope to tenant →
authorize → handle, and `requirePermission` asks the database through
`has_permission` rather than reading the JWT claim, which was only true when the
token was minted. Do not hand-roll that order.

`orgScoped` supplies `orgSlug`; without it there is nothing to scope to. Use
`authenticated()` only where membership does not yet exist (creating an org,
accepting an invite), and `withinOrg()` only where the rule genuinely depends on
the row — currently just issue status by assignee.

No business logic here, no authorization in the service. A `beforeLoad` guard
stops navigation; it does nothing about a POST fired straight at the endpoint.
This is the check that actually holds.

## 6. Query and loader

Add to `apps/reference/src/lib/queries.ts`, so a loader and the component reading it cannot
drift apart on the key — drift causes a refetch on hydration.

```ts
export const widgetsQuery = (orgSlug: string, page: number) =>
  queryOptions({
    queryKey: ["widgets", orgSlug, page] as const,
    queryFn: () => listWidgets({ orgSlug, page }),
  });
```

Importing a `"use server"` function here is intended: the compiler replaces the
body with an RPC stub in the client bundle.

In the route, `loaderDeps` then `ensureQueryData`. Without `loaderDeps` the
loader never re-runs when the page or a filter changes.

## 7. Route and table

Copy the shape of `apps/reference/src/routes/_authed/$orgSlug/projects/index.tsx`.

- Read `Route.useRouteContext()` as an **accessor**, never destructured. The
  `$orgSlug` layout does not remount when only the slug changes, so a snapshot
  leaves permission gates judging the previous organization after a switch.
- Wrap mutating UI in `<Can session={session()} orgId={org().id} permission="…">`.
  It hides buttons and protects nothing; the RPC checks the same permission.
- Wrap the table in `<ResponsiveTable>` from `apps/reference/src/components/data.tsx`, and give
  every `<Table.Cell>` one of `data-label="…"`, `data-primary`, or
  `data-actions`. Below `lg` each row becomes a card built from those
  attributes, so a cell with none renders as an unlabelled orphan line
  (`data-block` puts a long value under its label instead of beside it). See
  the plugin's Park UI skill for the rest of the table conventions.
- Add the nav link in `apps/reference/src/routes/_authed/$orgSlug.tsx`, gated with `can(...)`
  on the same permission. If the route declares `page` in its search schema the
  link must pass `search={{ page: 1 }}` — that is a type error, not a habit.

## 8. Pagination

Build it in from the start if the list can grow; retrofitting changes the
service return type, the query key and the route search schema at once.
`listIssues` in `apps/reference/src/server/services/issues.ts` is the fullest reference —
filters, an escaped `ilike`, and the range below.

```ts
const from = (input.page - 1) * input.pageSize;
const to = from + input.pageSize - 1;
const { data, error, count } = await query.range(from, to);   // .select(SELECT, { count: "exact" })
```

Return `{ rows, total, page, pageSize }`. Clamp `pageSize` in the **RPC** schema
(`.max(100).catch(25)`), not in the UI — the endpoint is public, so a client
asking for `pageSize=100000` has to be capped server-side.

Client side, `page` lives in the route's `validateSearch` schema with
`.catch(1)` so `?page=banana` degrades to page 1 instead of throwing, and
`<Pagination>` from `apps/reference/src/components/data.tsx` renders the footer.

## Errors

Use the constructors in `apps/reference/src/server/errors.ts`: `notFound`, `forbidden`,
`conflict`, `invalidInput`, `rateLimited`. Anything else thrown is replaced with
a generic message by `apps/reference/src/server/on-error.ts` before it reaches the client —
which is why a bare `throw new Error(...)` is right for a genuine fault and
useless for anything a user should read.

**A failed permission check on tenant data returns 404, not 403.** A 403
confirms the row exists, and probing ids would let one tenant map another's data
even while every read fails. `forbidden()` is correct only when the caller
already provably knows the resource exists — `requirePermission` uses it because
membership in that org is already established.

## Also touch

`exportOrg()` in `apps/reference/src/server/services/export.ts` enumerates tenant tables by
hand. A new table left out of it is silently missing from a GDPR export.

## Verify

```bash
npm run typecheck
npm test          # includes apps/reference/src/server/rls.integration.test.ts
```

`rls.integration.test.ts` talks to PostgREST with a real user's token and no
application code in the path. It is the only suite that can catch a policy which
silently returns another tenant's rows, so add cases there for the new table —
cross-tenant read comes back empty, an under-privileged role's insert is
refused — using the seeded Acme and Globex fixtures. It skips itself when the
local stack is down; CI fails the build if anything was skipped.
