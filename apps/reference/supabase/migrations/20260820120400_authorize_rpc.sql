-- ============================================================================
-- A callable authorization check.
--
-- private.authorize() is the authority, but `private` is not in PostgREST's
-- exposed schema list, so the application cannot call it. This wrapper gives
-- server functions a way to ask the *database* — not the JWT — whether the
-- current user holds a permission, so a stale claim can never authorize a
-- write.
--
-- SECURITY INVOKER is important: the function must run as the caller so that
-- auth.uid() inside private.authorize() resolves to the real user. Exposing it
-- leaks nothing, because it can only ever report on the caller's own access.
-- ============================================================================

create or replace function public.has_permission(
  permission public.app_permission,
  org_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.authorize(permission, org_id);
$$;

comment on function public.has_permission is
  'Authoritative, live permission check for the calling user. Never trust the JWT claim for writes.';

grant execute on function public.has_permission(public.app_permission, uuid) to authenticated;
revoke execute on function public.has_permission(public.app_permission, uuid) from anon, public;
