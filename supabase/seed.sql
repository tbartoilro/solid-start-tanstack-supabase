-- ============================================================================
-- Seed data.
--
-- One user per role inside "Acme", plus a completely separate "Globex" tenant.
-- Globex exists so tenant isolation is testable: nothing Acme's users do should
-- ever be able to reach it.
--
-- Every account uses the password `password123`.
-- ============================================================================

-- Creates a confirmed email/password user, mirroring what GoTrue writes on
-- signup. The on_auth_user_created trigger fills in public.profiles.
create or replace function private.seed_user(user_id uuid, user_email text, display_name text)
returns uuid
language plpgsql
as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000', user_id, 'authenticated', 'authenticated',
    user_email, extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    now(), now(), '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', display_name),
    '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  )
  values (
    gen_random_uuid(), user_id, user_id::text,
    jsonb_build_object('sub', user_id::text, 'email', user_email),
    'email', now(), now(), now()
  );

  return user_id;
end;
$$;

do $$
declare
  u_owner    uuid := '11111111-1111-1111-1111-111111111111';
  u_admin    uuid := '22222222-2222-2222-2222-222222222222';
  u_member   uuid := '33333333-3333-3333-3333-333333333333';
  u_viewer   uuid := '44444444-4444-4444-4444-444444444444';
  u_outsider uuid := '55555555-5555-5555-5555-555555555555';

  org_acme   uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  org_globex uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  proj_web   uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  proj_api   uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  proj_secret uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
begin
  perform private.seed_user(u_owner,    'owner@acme.test',      'Ada Owner');
  perform private.seed_user(u_admin,    'admin@acme.test',      'Alan Admin');
  perform private.seed_user(u_member,   'member@acme.test',     'Mira Member');
  perform private.seed_user(u_viewer,   'viewer@acme.test',     'Vic Viewer');
  perform private.seed_user(u_outsider, 'outsider@globex.test', 'Otto Outsider');

  -- Organizations. The organizations_add_owner trigger grants `created_by` the
  -- owner membership automatically, so it is not inserted by hand below.
  insert into public.organizations (id, slug, name, created_by) values
    (org_acme,   'acme',   'Acme Corporation', u_owner),
    (org_globex, 'globex', 'Globex Industries', u_outsider);

  insert into public.memberships (org_id, user_id, role) values
    (org_acme, u_admin,  'admin'),
    (org_acme, u_member, 'member'),
    (org_acme, u_viewer, 'viewer');

  insert into public.projects (id, org_id, name, key, description, created_by) values
    (proj_web, org_acme, 'Web Platform', 'WEB', 'Customer-facing web application', u_owner),
    (proj_api, org_acme, 'Public API',   'API', 'REST and GraphQL surface',        u_admin),
    -- Belongs to the other tenant. Acme users must never see this row.
    (proj_secret, org_globex, 'Globex Internal', 'GBX', 'Should be invisible to Acme', u_outsider);

  insert into public.issues (org_id, project_id, title, status, priority, assignee_id, created_by) values
    (org_acme, proj_web, 'Dashboard renders blank on first paint', 'in_progress', 'high',   u_member, u_admin),
    (org_acme, proj_web, 'Add dark mode toggle',                   'todo',        'low',    u_member, u_member),
    (org_acme, proj_web, 'Session expires too aggressively',       'backlog',     'medium', null,     u_owner),
    (org_acme, proj_api, 'Rate limit the invite endpoint',         'todo',        'urgent', u_admin,  u_owner),
    (org_acme, proj_api, 'Document pagination cursors',            'done',        'none',   u_viewer, u_admin),
    (org_globex, proj_secret, 'Globex confidential issue',         'todo',        'high',   null,     u_outsider);

  insert into public.invitations (org_id, email, role, invited_by) values
    (org_acme, 'newhire@acme.test', 'member', u_admin);
end;
$$;

drop function private.seed_user(uuid, text, text);
