-- ============================================================================
-- Triggers: invariants the application must not be trusted to maintain.
--
-- Anything in here is a rule that would be a security or data-integrity bug if
-- an application code path forgot it. Audit writes in particular are triggers
-- rather than service-layer calls precisely so that no write path can omit
-- them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at      before update on public.profiles      for each row execute function private.set_updated_at();
create trigger organizations_set_updated_at before update on public.organizations for each row execute function private.set_updated_at();
create trigger memberships_set_updated_at   before update on public.memberships   for each row execute function private.set_updated_at();
create trigger projects_set_updated_at      before update on public.projects      for each row execute function private.set_updated_at();
create trigger issues_set_updated_at        before update on public.issues        for each row execute function private.set_updated_at();

-- ----------------------------------------------------------------------------
-- auth.users -> public.profiles
-- ----------------------------------------------------------------------------
-- Without this, a freshly signed-up user has no profile row and every foreign
-- key pointing at profiles fails. Doing it in a trigger means it happens for
-- every signup path — password, magic link, OAuth — not just the ones the app
-- happens to implement.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Founding an organization makes you its owner
-- ----------------------------------------------------------------------------
-- The INSERT policy on organizations only checks `created_by = auth.uid()`.
-- Without this trigger the creator would immediately be locked out of the org
-- they just made, because every other policy is membership-derived.
create or replace function private.org_add_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.memberships (org_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (org_id, user_id) do nothing;

  return new;
end;
$$;

create trigger organizations_add_owner
  after insert on public.organizations
  for each row
  when (new.created_by is not null)
  execute function private.org_add_owner();

-- ----------------------------------------------------------------------------
-- Per-project sequential issue numbers
-- ----------------------------------------------------------------------------
-- Users expect PROJ-1, PROJ-2 rather than uuids. A plain `max(number) + 1` race
-- would produce duplicate numbers under concurrent inserts, so the transaction
-- takes an advisory lock keyed on the project first. The unique constraint on
-- (project_id, number) is still the real guarantee.
create or replace function private.assign_issue_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.number is not null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.project_id::text));

  select coalesce(max(i.number), 0) + 1
    into new.number
    from public.issues i
   where i.project_id = new.project_id;

  return new;
end;
$$;

create trigger issues_assign_number
  before insert on public.issues
  for each row execute function private.assign_issue_number();

-- ----------------------------------------------------------------------------
-- An organization must always retain at least one owner
-- ----------------------------------------------------------------------------
-- Both RLS and the service layer happily allow an owner to demote or remove
-- themselves. That is fine right up until they are the last one, at which point
-- the organization becomes permanently unadministrable.
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

create trigger memberships_protect_last_owner
  before update or delete on public.memberships
  for each row execute function private.protect_last_owner();

-- ----------------------------------------------------------------------------
-- Audit log
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER, so these writes bypass the audit_log RLS policy — which is
-- exactly the point: there is no INSERT policy, so this trigger is the only way
-- an entry can ever be created.
create or replace function private.audit_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger memberships_audit
  after insert or update or delete on public.memberships
  for each row execute function private.audit_membership();

create or replace function private.audit_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger projects_audit
  after insert or delete on public.projects
  for each row execute function private.audit_project();
