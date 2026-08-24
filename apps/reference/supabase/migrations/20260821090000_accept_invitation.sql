-- ============================================================================
-- Invitation acceptance.
--
-- The other half of a lifecycle the schema already described but nothing
-- completed: invitations could be created and revoked, but `accepted_at` was
-- never written and no membership was ever produced from one.
--
-- This has to be a database function rather than service-layer code, for two
-- reasons:
--
--   1. Atomicity. Inserting the membership and stamping `accepted_at` must
--      happen together. As two PostgREST calls, a double-submit can insert the
--      membership twice, or stamp acceptance for a membership that failed.
--
--   2. Authority. The invitee is not a member of the organization yet, so RLS
--      on `memberships` correctly refuses their insert — `members.manage` is
--      required and they hold nothing. SECURITY DEFINER is the narrow, audited
--      exception rather than handing the whole flow to the service-role key.
--
-- Being SECURITY DEFINER means this function does its own authorization, and
-- the check that matters is identity: a token proves someone was invited, not
-- that *this* caller is the invitee. Without the email comparison below, a
-- leaked or forwarded link would let any signed-in user join the organization.
-- ============================================================================

-- The OUT parameters are prefixed because a RETURNS TABLE column named `org_id`
-- or `role` is ambiguous against public.memberships inside this body — Postgres
-- rejects the ON CONFLICT target outright. The service layer maps these to
-- camelCase anyway, so the prefix costs nothing.
create or replace function public.accept_invitation(invite_token text)
returns table (out_org_id uuid, out_org_slug text, out_role public.app_role)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id    uuid := auth.uid();
  v_user_email text;
  v_invite     public.invitations;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Read the address from auth.users rather than public.profiles: profiles is a
  -- trigger-populated mirror and can lag an email change, and this comparison
  -- is the security boundary.
  select u.email into v_user_email
  from auth.users u
  where u.id = v_user_id;

  -- Lock the row so two concurrent accepts of the same token serialize here
  -- instead of both passing the accepted_at check.
  select * into v_invite
  from public.invitations i
  where i.token = invite_token
  for update;

  -- Every rejection below is deliberately the same opaque message. Telling the
  -- caller *why* a token failed distinguishes "expired", "already used" and
  -- "never existed", which turns this into an oracle for probing tokens.
  if v_invite.id is null
     or v_invite.accepted_at is not null
     or v_invite.expires_at <= now()
     or lower(v_invite.email) <> lower(v_user_email)
  then
    raise exception 'invitation_invalid' using errcode = 'P0002';
  end if;

  -- Idempotent: an invitation for an org the user somehow already belongs to
  -- resolves to their existing role rather than failing or silently changing it.
  insert into public.memberships (org_id, user_id, role)
  values (v_invite.org_id, v_user_id, v_invite.role)
  on conflict (org_id, user_id) do nothing;

  update public.invitations
  set accepted_at = now()
  where id = v_invite.id;

  return query
  select o.id, o.slug, m.role
  from public.organizations o
  join public.memberships m on m.org_id = o.id and m.user_id = v_user_id
  where o.id = v_invite.org_id;
end;
$$;

comment on function public.accept_invitation is
  'Redeems an invitation token for the calling user. Verifies the token is live and addressed to the caller''s own email before creating the membership.';

grant execute on function public.accept_invitation(text) to authenticated;
revoke execute on function public.accept_invitation(text) from anon, public;
