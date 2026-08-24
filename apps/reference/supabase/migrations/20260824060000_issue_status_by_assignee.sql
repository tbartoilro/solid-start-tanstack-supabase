-- ============================================================================
-- Let the person an issue is assigned to change its status.
--
-- The RLS policy on issues requires `issues.write`, which a viewer does not
-- have. That is correct for editing an issue, but wrong for the narrow case of
-- the assignee saying the work is done: being handed a task has to carry the
-- right to report on it, whatever role you otherwise hold.
--
-- This is a dedicated function rather than a widened RLS policy because the
-- permission is column-scoped. "May update the status" is not "may update the
-- row", and an UPDATE policy cannot express that difference — it would let an
-- assignee rewrite the title, move the issue to another project, or reassign it
-- to someone else. A function that takes only a status can only set a status.
-- ============================================================================

create or replace function public.set_issue_status(
  target_issue uuid,
  next_status public.issue_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  issue_org uuid;
  issue_assignee uuid;
  caller uuid := (select auth.uid());
begin
  select i.org_id, i.assignee_id
    into issue_org, issue_assignee
    from public.issues i
   where i.id = target_issue;

  -- Non-members are told the issue does not exist rather than that they may not
  -- touch it: a 403 here would confirm the id is real and let one tenant probe
  -- another's issue ids.
  if issue_org is null
     or private.user_org_role(issue_org, caller) is null then
    raise exception 'issue not found'
      using errcode = 'no_data_found';
  end if;

  -- Either the general write permission, or being the assignee.
  --
  -- Membership was already established above, and that check is load-bearing
  -- rather than redundant: removing someone from an organization does not clear
  -- assignee_id, so `assignee = caller` on its own would leave a removed member
  -- able to keep closing their old issues.
  if not (
    private.authorize('issues.write', issue_org)
    or issue_assignee = caller
  ) then
    raise exception 'not allowed to change this issue''s status'
      using errcode = 'insufficient_privilege';
  end if;

  update public.issues
     set status = next_status
   where id = target_issue;
end;
$$;

comment on function public.set_issue_status is
  'Status-only update. Allows the assignee through without issues.write; see the migration for why this is a function and not an RLS policy.';

grant execute on function public.set_issue_status(uuid, public.issue_status) to authenticated;
revoke execute on function public.set_issue_status(uuid, public.issue_status) from anon, public;
