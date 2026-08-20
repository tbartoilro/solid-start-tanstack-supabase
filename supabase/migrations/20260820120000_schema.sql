-- ============================================================================
-- Core schema: organizations, membership, and the project/issue domain.
--
-- Every tenant-owned table carries `org_id` directly, even where it could be
-- derived through a join (issues -> projects -> org). That denormalisation is
-- deliberate: RLS policies run per row, and a policy that has to join to find
-- the tenant is dramatically more expensive than one that reads a local,
-- indexed column.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

-- Roles are ordered conceptually: owner > admin > member > viewer. The ordering
-- is not encoded here on purpose — permissions are granted explicitly through
-- role_permissions rather than inferred from a hierarchy, so that adding a
-- permission never silently widens a role's reach.
create type public.app_role as enum ('owner', 'admin', 'member', 'viewer');

create type public.app_permission as enum (
  'projects.read',
  'projects.write',
  'projects.delete',
  'issues.read',
  'issues.write',
  'issues.assign',
  'members.read',
  'members.invite',
  'members.manage',
  'org.settings',
  'audit.read'
);

create type public.issue_status as enum ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled');
create type public.issue_priority as enum ('none', 'low', 'medium', 'high', 'urgent');

-- ----------------------------------------------------------------------------
-- Profiles: application-facing mirror of auth.users
-- ----------------------------------------------------------------------------
-- auth.users is owned by GoTrue and should not be joined against from app
-- queries or exposed through the API. profiles is the public projection,
-- populated by a trigger in the triggers migration.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Public projection of auth.users. Never expose auth.users directly.';

-- ----------------------------------------------------------------------------
-- Organizations (tenants)
-- ----------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
                check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  name        text not null check (length(trim(name)) between 1 and 100),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Memberships: the user <-> org edge, carrying the per-org role
-- ----------------------------------------------------------------------------
-- This is the single source of truth for "who may do what, where". A user with
-- no row here has no access to the organization at all.
create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.app_role not null default 'member',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, user_id)
);

-- ----------------------------------------------------------------------------
-- Projects
-- ----------------------------------------------------------------------------
create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 120),
  key          text not null check (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  description  text,
  archived_at  timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Project keys are unique per tenant, not globally.
  unique (org_id, key)
);

-- ----------------------------------------------------------------------------
-- Issues
-- ----------------------------------------------------------------------------
create table public.issues (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  number       integer not null,
  title        text not null check (length(trim(title)) between 1 and 200),
  description  text,
  status       public.issue_status not null default 'backlog',
  priority     public.issue_priority not null default 'none',
  assignee_id  uuid references public.profiles (id) on delete set null,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (project_id, number)
);

-- ----------------------------------------------------------------------------
-- Invitations
-- ----------------------------------------------------------------------------
create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  email       text not null check (position('@' in email) > 1),
  role        public.app_role not null default 'member',
  -- Random, single-use, and never derived from the row id.
  token       text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  invited_by  uuid references public.profiles (id) on delete set null,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Only one outstanding invite per email per org.
create unique index invitations_pending_unique
  on public.invitations (org_id, lower(email))
  where accepted_at is null;

-- ----------------------------------------------------------------------------
-- Audit log
-- ----------------------------------------------------------------------------
-- Append-only. There is deliberately no UPDATE or DELETE policy anywhere in the
-- RLS migration, so even an org owner cannot rewrite history through the API.
create table public.audit_log (
  id           bigserial primary key,
  org_id       uuid not null references public.organizations (id) on delete cascade,
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  target_type  text,
  target_id    text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
