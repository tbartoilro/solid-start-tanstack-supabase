-- ============================================================================
-- Three triggers between them made organizations permanently undeletable.
--
-- `protect_last_owner` fires `before delete on memberships` for each row, so it
-- also fires when those rows go away as a cascade from deleting the
-- organization itself. The final owner's membership always trips it, which
-- meant `delete from organizations` could never succeed — including through the
-- "orgs: owner can delete" policy in the RLS migration, which advertised a
-- capability the schema then refused.
--
-- The rule is about keeping a *surviving* organization administrable. If the
-- organization is going away there is nothing left to administer.
--
-- The audit triggers had the same shape of problem behind it: they write a row
-- recording the removal, and `audit_log.org_id` references `organizations`, so
-- during a teardown that write fails the foreign key. An audit entry describing
-- an organization that no longer exists has nowhere to be read from anyway —
-- the audit screen is scoped to a tenant — so the write is skipped rather than
-- the constraint relaxed.
--
-- All three guards test the same thing: Postgres removes the parent row before
-- applying the cascade to its children, so the parent already being gone is
-- what distinguishes a teardown from an ordinary edit.
-- ============================================================================

create or replace function private.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_owners integer;
  target_org uuid := old.org_id;
begin
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;

  -- Still an owner after this change? Then nothing to protect against.
  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;

  -- Teardown rather than someone abandoning a live organization.
  if tg_op = 'DELETE' and not exists (
    select 1 from public.organizations o where o.id = target_org
  ) then
    return old;
  end if;

  select count(*)
    into remaining_owners
    from public.memberships m
   where m.org_id = target_org
     and m.role = 'owner'
     and m.id <> old.id;

  if remaining_owners = 0 then
    raise exception 'organization % must retain at least one owner', target_org
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function private.audit_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The organization is already gone, so there is no tenant left to own this
  -- entry and the foreign key would reject it.
  if tg_op = 'DELETE' and not exists (
    select 1 from public.organizations o where o.id = old.org_id
  ) then
    return old;
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_log (org_id, actor_id, action, target_type, target_id, metadata)
    values (new.org_id, auth.uid(), 'member.added', 'membership', new.id::text,
            jsonb_build_object('user_id', new.user_id, 'role', new.role));
    return new;

  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    insert into public.audit_log (org_id, actor_id, action, target_type, target_id, metadata)
    values (new.org_id, auth.uid(), 'member.role_changed', 'membership', new.id::text,
            jsonb_build_object('user_id', new.user_id, 'from', old.role, 'to', new.role));
    return new;

  elsif tg_op = 'DELETE' then
    insert into public.audit_log (org_id, actor_id, action, target_type, target_id, metadata)
    values (old.org_id, auth.uid(), 'member.removed', 'membership', old.id::text,
            jsonb_build_object('user_id', old.user_id, 'role', old.role));
    return old;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function private.audit_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.organizations o where o.id = old.org_id
  ) then
    return old;
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_log (org_id, actor_id, action, target_type, target_id, metadata)
    values (new.org_id, auth.uid(), 'project.created', 'project', new.id::text,
            jsonb_build_object('name', new.name, 'key', new.key));
    return new;

  elsif tg_op = 'DELETE' then
    insert into public.audit_log (org_id, actor_id, action, target_type, target_id, metadata)
    values (old.org_id, auth.uid(), 'project.deleted', 'project', old.id::text,
            jsonb_build_object('name', old.name, 'key', old.key));
    return old;
  end if;

  return coalesce(new, old);
end;
$$;
