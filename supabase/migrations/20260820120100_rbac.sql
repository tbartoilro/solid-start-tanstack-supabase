-- ============================================================================
-- RBAC: role -> permission mapping, authorization helpers, and the JWT hook.
--
-- Two mechanisms exist here and it matters which one is authoritative:
--
--   private.authorize()          -> the source of truth. Hits the database,
--                                   always current, used by every RLS policy
--                                   and every mutating server function.
--
--   custom_access_token_hook()   -> a fast path. Stamps the user's memberships
--                                   into the JWT so the app can render the
--                                   right navigation without a round-trip.
--
-- The JWT claim is a *cache*, and like any cache it goes stale: revoking a
-- role does not invalidate already-issued tokens, so a demoted user keeps the
-- old claim until their token refreshes. That is acceptable for deciding which
-- buttons to draw and never acceptable for deciding whether a write succeeds.
-- ============================================================================

-- Helper functions live in `private`, which is not in PostgREST's exposed
-- schema list — that, not privilege revocation, is what stops a client calling
-- them as RPC.
--
-- `authenticated` *must* keep USAGE and EXECUTE here: an RLS policy expression
-- is evaluated with the privileges of the querying role, so revoking access
-- would make every policy that calls these helpers fail outright.
create schema if not exists private;
grant usage on schema private to authenticated;
revoke all on schema private from anon;

-- ----------------------------------------------------------------------------
-- Role -> permission mapping
-- ----------------------------------------------------------------------------
create table public.role_permissions (
  role        public.app_role not null,
  permission  public.app_permission not null,
  primary key (role, permission)
);

comment on table public.role_permissions is
  'Static policy table. Editing a role''s reach is a migration, not runtime data.';

insert into public.role_permissions (role, permission) values
  -- owner: everything, including destroying the org and managing billing
  ('owner', 'projects.read'), ('owner', 'projects.write'), ('owner', 'projects.delete'),
  ('owner', 'issues.read'),   ('owner', 'issues.write'),   ('owner', 'issues.assign'),
  ('owner', 'members.read'),  ('owner', 'members.invite'), ('owner', 'members.manage'),
  ('owner', 'org.settings'),  ('owner', 'audit.read'),

  -- admin: everything except changing org-level settings
  ('admin', 'projects.read'), ('admin', 'projects.write'), ('admin', 'projects.delete'),
  ('admin', 'issues.read'),   ('admin', 'issues.write'),   ('admin', 'issues.assign'),
  ('admin', 'members.read'),  ('admin', 'members.invite'), ('admin', 'members.manage'),
  ('admin', 'audit.read'),

  -- member: does the work, cannot delete projects or manage people
  ('member', 'projects.read'), ('member', 'projects.write'),
  ('member', 'issues.read'),   ('member', 'issues.write'), ('member', 'issues.assign'),
  ('member', 'members.read'),

  -- viewer: read-only
  ('viewer', 'projects.read'),
  ('viewer', 'issues.read'),
  ('viewer', 'members.read');

-- ----------------------------------------------------------------------------
-- private.user_org_role
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER so it can read memberships without being subject to the RLS
-- policies that are themselves defined in terms of this function — that would
-- otherwise recurse infinitely.
--
-- `set search_path = ''` forces every reference to be schema-qualified, so a
-- caller cannot shadow `public` with their own table and redirect the lookup.
create or replace function private.user_org_role(target_org uuid, target_user uuid)
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.memberships m
  where m.org_id = target_org
    and m.user_id = target_user;
$$;

-- ----------------------------------------------------------------------------
-- private.authorize
-- ----------------------------------------------------------------------------
-- The authorization primitive. Answers: "may the current user perform this
-- permission inside this organization?" Non-membership and insufficient role
-- are both simply false.
create or replace function private.authorize(
  requested public.app_permission,
  target_org uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.role = m.role
    where m.org_id = target_org
      and m.user_id = (select auth.uid())
      and rp.permission = requested
  );
$$;

comment on function private.authorize is
  'Authoritative permission check. Always current; used by RLS and server functions.';

-- ----------------------------------------------------------------------------
-- public.custom_access_token_hook
-- ----------------------------------------------------------------------------
-- Runs inside GoTrue whenever an access token is minted or refreshed, and adds
-- an `orgs` claim shaped as [{"id": <uuid>, "slug": <text>, "role": <app_role>}].
--
-- Only membership edges are embedded, never the resolved permission set: the
-- permission mapping can change in a migration without every outstanding token
-- carrying a stale copy of it.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  user_orgs jsonb;
begin
  select coalesce(
           jsonb_agg(
             jsonb_build_object('id', o.id, 'slug', o.slug, 'role', m.role)
             order by o.name
           ),
           '[]'::jsonb
         )
    into user_orgs
    from public.memberships m
    join public.organizations o on o.id = m.org_id
   where m.user_id = (event->>'user_id')::uuid;

  claims := event->'claims';
  claims := jsonb_set(claims, '{orgs}', user_orgs);

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- GoTrue runs the hook as supabase_auth_admin, which needs to reach the tables
-- the hook reads. Everyone else is explicitly denied the ability to call it, so
-- a client cannot invoke the hook to enumerate another user's memberships.
grant usage on schema public to supabase_auth_admin;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from anon, authenticated, public;

grant select on public.memberships, public.organizations to supabase_auth_admin;

-- Required for RLS policies that call these helpers (see the note on the
-- `private` schema above).
grant execute on function private.authorize(public.app_permission, uuid) to authenticated;
grant execute on function private.user_org_role(uuid, uuid) to authenticated;
revoke execute on function private.authorize(public.app_permission, uuid) from anon, public;
revoke execute on function private.user_org_role(uuid, uuid) from anon, public;

-- ----------------------------------------------------------------------------
-- Read access to the permission map
-- ----------------------------------------------------------------------------
-- The client is allowed to know which permissions a role implies so it can
-- render consistent UI. Knowing the mapping grants nothing on its own.
grant select on public.role_permissions to authenticated;
