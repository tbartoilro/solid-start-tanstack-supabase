-- ============================================================================
-- Row Level Security: the backstop.
--
-- The application already authorizes every mutation in its server functions.
-- These policies exist so that a bug in that layer — or a query issued from
-- anywhere else with a user's token — still cannot cross a tenant boundary.
--
-- Two performance rules are applied throughout, both from Supabase's RLS
-- guidance:
--
--   1. Every helper call is wrapped in `(select ...)`. Postgres then evaluates
--      it once per statement as an InitPlan instead of once per row. On a table
--      of any size this is the difference between a scan and a timeout.
--   2. Every column referenced by a policy is indexed.
-- ============================================================================

alter table public.profiles         enable row level security;
alter table public.organizations    enable row level security;
alter table public.memberships      enable row level security;
alter table public.projects         enable row level security;
alter table public.issues           enable row level security;
alter table public.invitations      enable row level security;
alter table public.audit_log        enable row level security;
alter table public.role_permissions enable row level security;

-- ----------------------------------------------------------------------------
-- Indexes backing the policies
-- ----------------------------------------------------------------------------
create index memberships_user_id_idx      on public.memberships (user_id);
create index memberships_org_id_idx       on public.memberships (org_id);
create index projects_org_id_idx          on public.projects (org_id);
create index issues_org_id_idx            on public.issues (org_id);
create index issues_project_id_idx        on public.issues (project_id);
create index issues_assignee_id_idx       on public.issues (assignee_id);
create index issues_status_idx            on public.issues (org_id, status);
create index invitations_org_id_idx       on public.invitations (org_id);
create index audit_log_org_id_created_idx on public.audit_log (org_id, created_at desc);

-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------
-- A user can see themselves, plus anyone they share an organization with —
-- otherwise assignee pickers and member lists would render empty. Crucially
-- this does not leak the wider user table to unrelated tenants.
create policy "profiles: self or co-member readable"
  on public.profiles for select
  to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.memberships mine
      join public.memberships theirs on theirs.org_id = mine.org_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = public.profiles.id
    )
  );

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- organizations
-- ----------------------------------------------------------------------------
create policy "orgs: members can read"
  on public.organizations for select
  to authenticated
  using ((select private.user_org_role(id, (select auth.uid()))) is not null);

-- Anyone signed in may found an organization; a trigger immediately makes them
-- its owner.
create policy "orgs: authenticated can create"
  on public.organizations for insert
  to authenticated
  with check (created_by = (select auth.uid()));

create policy "orgs: settings permission can update"
  on public.organizations for update
  to authenticated
  using ((select private.authorize('org.settings', id)))
  with check ((select private.authorize('org.settings', id)));

-- Deleting a tenant is owner-only and deliberately not delegated to a
-- permission, so it can never be granted to a role by editing role_permissions.
create policy "orgs: owner can delete"
  on public.organizations for delete
  to authenticated
  using ((select private.user_org_role(id, (select auth.uid()))) = 'owner');

-- ----------------------------------------------------------------------------
-- memberships
-- ----------------------------------------------------------------------------
create policy "memberships: members.read can list"
  on public.memberships for select
  to authenticated
  using ((select private.authorize('members.read', org_id)));

create policy "memberships: members.manage can add"
  on public.memberships for insert
  to authenticated
  with check ((select private.authorize('members.manage', org_id)));

create policy "memberships: members.manage can change role"
  on public.memberships for update
  to authenticated
  using ((select private.authorize('members.manage', org_id)))
  with check ((select private.authorize('members.manage', org_id)));

-- A user may always remove themselves; otherwise members.manage is required.
create policy "memberships: manage or self can remove"
  on public.memberships for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.authorize('members.manage', org_id))
  );

-- ----------------------------------------------------------------------------
-- projects
-- ----------------------------------------------------------------------------
create policy "projects: read"
  on public.projects for select
  to authenticated
  using ((select private.authorize('projects.read', org_id)));

create policy "projects: write can insert"
  on public.projects for insert
  to authenticated
  with check ((select private.authorize('projects.write', org_id)));

create policy "projects: write can update"
  on public.projects for update
  to authenticated
  using ((select private.authorize('projects.write', org_id)))
  with check ((select private.authorize('projects.write', org_id)));

create policy "projects: delete permission can delete"
  on public.projects for delete
  to authenticated
  using ((select private.authorize('projects.delete', org_id)));

-- ----------------------------------------------------------------------------
-- issues
-- ----------------------------------------------------------------------------
create policy "issues: read"
  on public.issues for select
  to authenticated
  using ((select private.authorize('issues.read', org_id)));

create policy "issues: write can insert"
  on public.issues for insert
  to authenticated
  with check ((select private.authorize('issues.write', org_id)));

create policy "issues: write can update"
  on public.issues for update
  to authenticated
  using ((select private.authorize('issues.write', org_id)))
  with check ((select private.authorize('issues.write', org_id)));

create policy "issues: write can delete"
  on public.issues for delete
  to authenticated
  using ((select private.authorize('issues.write', org_id)));

-- ----------------------------------------------------------------------------
-- invitations
-- ----------------------------------------------------------------------------
-- Note there is no policy exposing invitations by token: accepting an invite
-- happens through a server function using the secret key, so the token is never
-- queryable by an unauthenticated client fishing for valid tokens.
create policy "invitations: members.read can list"
  on public.invitations for select
  to authenticated
  using ((select private.authorize('members.read', org_id)));

create policy "invitations: members.invite can create"
  on public.invitations for insert
  to authenticated
  with check ((select private.authorize('members.invite', org_id)));

create policy "invitations: members.manage can revoke"
  on public.invitations for delete
  to authenticated
  using ((select private.authorize('members.manage', org_id)));

-- ----------------------------------------------------------------------------
-- audit_log  (append-only, and not even append from a client)
-- ----------------------------------------------------------------------------
create policy "audit: audit.read can read"
  on public.audit_log for select
  to authenticated
  using ((select private.authorize('audit.read', org_id)));

-- Intentionally no INSERT/UPDATE/DELETE policy. Entries are written by
-- SECURITY DEFINER triggers, which bypass RLS, so history cannot be forged or
-- rewritten through the API by anyone — including an owner.

-- ----------------------------------------------------------------------------
-- role_permissions (public reference data)
-- ----------------------------------------------------------------------------
create policy "role_permissions: readable by authenticated"
  on public.role_permissions for select
  to authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- Table grants
-- ----------------------------------------------------------------------------
-- RLS narrows what a role may touch; it does not grant anything. Both are
-- required. `anon` is granted nothing at all: every table here is tenant data.
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.projects    to authenticated;
grant select, insert, update, delete on public.issues      to authenticated;
grant select, insert, delete         on public.invitations to authenticated;
grant select, insert, update, delete on public.organizations to authenticated;
grant select, update                 on public.profiles    to authenticated;
grant select                         on public.audit_log   to authenticated;

revoke all on public.audit_log from anon;
revoke all on public.memberships from anon;
revoke all on public.organizations from anon;
revoke all on public.projects from anon;
revoke all on public.issues from anon;
revoke all on public.invitations from anon;
revoke all on public.profiles from anon;
