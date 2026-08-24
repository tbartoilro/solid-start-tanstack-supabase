---
name: add-permission
description: This skill should be used when changing who is allowed to do what in this template — "add a permission", "add a new role", "restrict this to admins", "why can a viewer still do X", "who can do X", "change what a viewer can do", "gate this button", "make this owner-only", "my new permission does not exist in TypeScript", "admin cannot create an owner", "the last owner cannot be removed". Covers the app_permission enum, role_permissions seeding, private.authorize(), the authorize() RPC guard, <Can>, RLS policy shape, and the escalation rules that permissions cannot express.
version: 0.1.0
---

# Adding or changing a permission

## The model, in one paragraph

Permissions are data, not code. `public.app_permission` is a Postgres enum;
`public.role_permissions` maps role -> permission; `private.authorize(permission, org_id)`
answers "may the current user do this here" by joining `memberships` to `role_permissions`.
Every RLS policy and every server-side check funnels through that one function, so
**granting a permission to a role is an INSERT, not a code change**. The JWT carries only
membership edges (`orgs` claim), never a resolved permission set — see the header comment
in `supabase/migrations/20260820120100_rbac.sql` for why that cache boundary is drawn there.

Read these before editing:

- `supabase/migrations/20260820120000_schema.sql` — the enum (lines ~21-33)
- `supabase/migrations/20260820120100_rbac.sql` — `role_permissions` seed, `private.authorize`, the JWT hook
- `supabase/migrations/20260820120200_rls.sql` — every policy, and the two performance rules
- `supabase/migrations/20260820120400_authorize_rpc.sql` — `public.has_permission`, the callable wrapper
- `src/server/guard.ts`, `src/server/context.ts`, `src/lib/auth.ts`

## Recipe

### 1. Add the enum value — in a NEW migration

Never edit an applied migration; the CLI tracks them by hash and other clones have already
run them. Create `supabase/migrations/<timestamp>_<name>.sql` (or `supabase migration new <name>`):

```sql
alter type public.app_permission add value if not exists 'reports.read';
```

**Trap:** `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that adds it, and
the Supabase CLI runs each migration file in its own transaction. So the enum value and any
`insert into role_permissions` using it must be in **two separate files**. This is exactly why
`20260821100000_saas_seams.sql` and `20260821100100_saas_seam_grants.sql` are a pair — read
them; they are the worked example. Skipping this produces `unsafe use of new value of enum type`.

### 2. Grant it to roles — in the next migration

Match the style of the seed in `20260820120100_rbac.sql`:

```sql
insert into public.role_permissions (role, permission) values
  ('owner', 'reports.read'),
  ('admin', 'reports.read')
on conflict do nothing;
```

Roles are **not** hierarchical. `app_role` is ordered conceptually (owner > admin > member >
viewer) but nothing infers grants from that ordering — if a role should hold the permission,
name it explicitly. That is deliberate, so adding a permission never silently widens a role.

### 3. Enforcement is already done

Nothing else is needed for the database side. `private.authorize()` reads `role_permissions`
live, so every existing policy and check picks the new row up immediately. There is no
permission list in TypeScript to keep in sync (see step 6) and no JWT to invalidate — the
claim holds memberships, not permissions.

### 4. Enforce at the RPC boundary

Every tenant-scoped `"use server"` function goes through `authorize()` from `src/server/guard.ts`:

```ts
const schema = orgScoped.extend({ page: z.coerce.number().int().min(1).catch(1) });

export async function listReports(input: unknown) {
  const { input: data, ctx } = await authorize("reports.read", schema, input);
  return reports.listReports(ctx, data);
}
```

Order is fixed: validate -> scope to tenant -> authorize -> handle. `authorize` calls
`requirePermission` in `src/server/context.ts`, which does an RPC to `has_permission` — it asks
the **database**, not `ctx.role` from the JWT, because that role was true when the token was
minted and may not be now. `src/server/rpc/org.ts` `exportOrganization` is a compact example.

Two narrower guards exist in the same file:

- `authenticated(schema, raw)` — signed in, no tenant, no permission. For calls that happen
  before membership exists (`createOrganization`, accepting an invite). It performs **no**
  permission check; do not reach for it to skip one.
- `withinOrg(schema, raw)` — validates and scopes to a tenant but asserts no permission. Only
  for rules that depend on the row itself (see "the rule that is not a permission" below).

### 5. Gate the UI — this is cosmetic

```tsx
<Can session={session()} orgId={org().id} permission="reports.read">
  <ReportsPanel />
</Can>
```

or `can(session(), org().id, "reports.read")` from `src/lib/auth.ts` for conditional logic —
that is how the sidebar in `src/routes/_authed/$orgSlug.tsx` filters its links.

`<Can>` hides UI. It protects nothing: the permission list was resolved when the session was
fetched and can be stale, and the endpoint is a plain HTTP POST anyone can issue directly. Its
only job is to stop offering buttons that would fail. **Every `<Can>` must have a matching
`authorize()` on the server.** `e2e/rbac.spec.ts` asserts both halves for the same action.

### 6. Regenerate types

```
npm run db:types    # supabase gen types typescript --local > src/lib/database.types.ts
```

`AppPermission` in `src/lib/auth.ts` is `Database["public"]["Enums"]["app_permission"]`, derived
from the generated file rather than hand-written. So the new permission becomes available to
`authorize()`, `can()` and `<Can permission=...>` automatically — and **forgetting the regen is
why TypeScript says your permission does not exist**. Run `npm run db:reset` first if the
migration has not been applied locally; the generator reads the running database, not the SQL.

### 7. Add an RLS policy if a new table is involved

```sql
alter table public.reports enable row level security;
create index reports_org_id_idx on public.reports (org_id);

create policy "reports: read"
  on public.reports for select
  to authenticated
  using ((select private.authorize('reports.read', org_id)));

grant select on public.reports to authenticated;
revoke all on public.reports from anon;
```

Three rules, all of them load-bearing:

1. **Wrap the helper in `(select ...)`.** Postgres then evaluates it once per statement as an
   InitPlan instead of once per row. Without it, a table of any size turns a scan into a
   timeout. Every policy in `20260820120200_rls.sql` does this; match them.
2. **Index every column a policy references.** `org_id` at minimum.
3. **RLS narrows, it does not grant.** A table with a perfect policy and no `grant` returns
   nothing. Both are required, and `anon` gets nothing — every table here is tenant data.

Carry `org_id` on the table directly even when it could be derived through a join. Policies run
per row, and a policy that joins to find its tenant is far more expensive than one reading a
local indexed column.

### 8. Test it

- `src/server/rls.integration.test.ts` — talks to PostgREST with a real user's token and **no
  application code in the path**, so it proves the database refuses the write even if the app
  layer were bypassed. Seeded users: `owner@acme.test`, `admin@acme.test`, `member@acme.test`,
  `viewer@acme.test`, `outsider@globex.test`, password `password123`. Tests skip automatically
  when the local stack is down; CI fails if anything was skipped.
- `e2e/rbac.spec.ts` — the UI half plus `callRpc(page, module, fn, payload)` from `e2e/helpers.ts`,
  which invokes the server function directly to prove hiding the button was not the protection.

`npm run verify` runs typecheck, vitest and Playwright.

## Rules that permissions cannot express

`members.manage` answers "may this user administer members at all". It cannot answer questions
relative to actor and target. Those live in `src/server/services/members.ts`:

- **An admin may not mint an owner.** `assertCanAssignRole(actorRole, targetRole)` — you may
  grant any role up to and including your own. Without it an admin legitimately holding
  `members.manage` could create an owner and escalate past their own authority. It also runs
  against the *target's current* role, so you cannot act on someone who outranks you.
- **Nobody edits their own role.** `changeMemberRole` rejects `target.user_id === ctx.userId`.
  Promotion is escalation by definition; demotion should be someone else's deliberate act.
- **The last owner cannot be removed or demoted.** Enforced by the `memberships_protect_last_owner`
  trigger (`private.protect_last_owner` in `20260820120300_triggers.sql`), not by application
  code — so it holds against direct PostgREST calls too. The service layer recognises the
  message `must retain at least one owner` and converts it to a `conflict()`.

Also note: **deleting an organization is owner-only and deliberately not a permission.** The
policy tests `private.user_org_role(id, auth.uid()) = 'owner'` directly, so it can never be
granted to a role by editing `role_permissions`. If you are asked to make org deletion
delegable, that is a policy change, not a grant.

`org.billing` exists as a permission with **no implementation behind it** — the template
deliberately does not pick a payment provider. It is a seam to gate your billing UI on.

## The rule that is not a permission: issue status

An issue's assignee may change its status without `issues.write`. See
`supabase/migrations/20260824060000_issue_status_by_assignee.sql`.

This is `public.set_issue_status(target_issue, next_status)` — a SECURITY DEFINER function —
rather than a widened RLS policy, because **the permission is column-scoped**. "May update the
status" is not "may update the row", and an UPDATE policy cannot express that difference: it
would let an assignee rewrite the title, move the issue to another project, or reassign it. A
function that takes only a status can only set a status.

The function checks membership *first* and separately from assignment, which is not redundant:
removing someone from an org does not clear `assignee_id`, so `assignee = caller` alone would
leave a removed member closing their old issues. Non-members get `no_data_found` rather than a
403, so issue ids cannot be probed across tenants.

Call path: `setIssueStatus` in `src/server/rpc/issues.ts` uses `withinOrg` (membership only),
then `ctx.db.rpc("set_issue_status", ...)`. The UI mirror is `canSetStatus()` in
`src/components/IssueControls.tsx`, which calls `setIssueStatus` and never `updateIssue` —
the latter demands `issues.write` and would refuse the very assignee the control exists for.

Use this pattern only when the rule genuinely depends on the row. Reach for `authorize()` first.
