-- ============================================================================
-- Demo dataset: real volume, for exercising the tables and pagination by hand.
--
-- Deliberately NOT part of supabase/seed.sql. The seed is also a test fixture,
-- and loading it up would make every count assertion in the suite fragile. This
-- is opt-in and `npm run db:reset` removes all of it.
--
--   npm run db:demo
--
-- It fills two organizations:
--
--   Acme Corporation  — the one the seeded accounts already belong to, so sign
--                       in as owner@acme.test / password123 as usual and the
--                       tables are simply full. 42 projects, ~690 issues, 64
--                       members. The seed's own rows are left exactly as they
--                       were, so the suite still recognises them.
--
--   Northwind Trading — a second, unrelated tenant, so the organization
--                       switcher has somewhere to switch to and tenant
--                       isolation is visible at volume. Owned by
--                       dana.whitfield@northwind.test.
--
-- Sized against a page size of 25 (50 for the audit log): every table pages,
-- and the issues list pages roughly twenty-eight times.
--
-- NOTE: run `npm run db:reset` before running the test suite. Several tests
-- assert against the seed's exact contents and a few locate a seeded row by
-- looking at the first page of a list, which this deliberately buries.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

-- Creates a confirmed email/password user, mirroring what GoTrue writes on
-- signup. Same shape as the seed's own helper, which drops itself at the end of
-- the seed and so is not available here.
create or replace function private.demo_user(user_email text, display_name text)
returns uuid
language plpgsql
as $$
declare
  new_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
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
    gen_random_uuid(), new_id, new_id::text,
    jsonb_build_object('sub', new_id::text, 'email', user_email),
    'email', now(), now(), now()
  );

  return new_id;
end;
$$;

-- The shared name pool. Sliced by offset so two organizations never end up
-- staffed by the same people.
create or replace function private.demo_people()
returns text[]
language sql
immutable
as $$
  select array[
    'Dana Whitfield','Marcus Bello','Priya Raghunathan','Tom Okonkwo','Elena Vasquez',
    'Jonas Lindqvist','Amara Diallo','Wei Chen','Sofia Marchetti','Ibrahim Haddad',
    'Grace Mbeki','Lukas Brandt','Nadia Petrova','Samuel Adeyemi','Hana Kobayashi',
    'Oliver Fitzgerald','Zara Malik','Diego Ramirez','Freya Andersen','Kwame Asante',
    'Isabelle Moreau','Ravi Krishnan','Mia Sorensen','Tobias Weber','Leila Farsi',
    'Connor Walsh','Yuki Tanaka','Adaeze Nwosu','Pablo Herrera','Anneke de Vries',
    'Hassan Karim','Clara Bergstrom','Rohan Mehta','Simone Laurent','Viktor Novak',
    'Naomi Fischer','Emeka Obi','Camila Duarte','Aleksander Nowak','Thandiwe Mokoena',
    'Julien Rousseau','Meera Pillai','Fabian Koch','Aisha Rahman','Lorenzo Ricci',
    'Astrid Nilsen','Daniel Kimani','Sun-Hee Park','Matteo Greco','Chidi Eze',
    'Ingrid Halvorsen','Arjun Bhatt','Beatriz Santos','Nils Eriksson','Layla Haddadi',
    'Stefan Vogel','Nkechi Achebe','Elias Berg','Rosa Delgado','Tariq Mansour',
    'Johanna Klein','Kenji Watanabe','Amelie Dubois','Victor Osei','Anja Kovac',
    'Ravi Deshpande','Marta Nowicka','Caleb Turner',
    'Helena Brandt','Omar Sesay','Lucia Ferrari','Pieter Janssen','Sanne Bakker',
    'Kofi Mensah','Bianca Lombardi','Andrei Popescu','Yara Nasser','Erik Lindgren',
    'Chloe Beaumont','Ganesh Iyer','Miriam Katz','Sipho Dlamini','Renata Alves',
    'Tomas Horak','Fatima Zahra','Lars Pedersen','Nina Sokolova','Joseph Mwangi',
    'Delphine Girard','Anil Chopra','Greta Hoffmann','Emmanuel Sarr','Paola Rossi',
    'Bjorn Haugen','Rania Aziz','Duc Nguyen','Carmen Ortega','Felix Neumann',
    'Aoife Byrne','Krishna Varma','Solveig Dahl','Idris Bello','Valeria Costa',
    'Henrik Olsen','Noor Rahman','Santiago Vega','Katrin Wagner','Blessing Okoro',
    'Emil Sandberg','Divya Menon','Rafael Pinto','Marion Leclerc','Zoltan Kiss',
    'Mariam Toure', 'Casper de Groot','Ling Zhao','Petra Novotna','Adam Whitaker',
    'Yusuf Demir','Sara Lindholm','Nikhil Joshi','Teresa Marquez','Otto Lehmann',
    'Hana Farouk','Gabriel Mendes','Ulrike Bauer','Joan Ferrer','Sekou Camara'
  ];
$$;

/**
 * Fills an existing organization with projects, issues and people.
 *
 * Additive on purpose: it never touches rows that are already there, which is
 * what lets it run against Acme without disturbing the seeded fixture the test
 * suite recognises.
 *
 * `proj_from`/`proj_to` slice the project catalogue, so two organizations can
 * be populated without colliding on `unique (org_id, key)` — Acme already owns
 * WEB and API, which are entries 1 and 2.
 */
create or replace function private.demo_populate(
  target_org    uuid,
  proj_from     int,
  proj_to       int,
  email_domain  text,
  member_count  int,
  name_offset   int
)
returns void
language plpgsql
as $$
declare
  people text[] := private.demo_people();

  -- Roles skew the way a real organization does: mostly members, a few admins,
  -- a long tail of read-only stakeholders. No 'owner' — each org already has
  -- one, and minting more from a modulo would be an accident rather than a
  -- decision.
  roles public.app_role[] := array['admin','admin','admin','member','member',
    'member','member','member','member','member','viewer','viewer'];

  proj_names text[] := array[
    'Web Platform','Public API','Mobile App','Billing Service','Data Warehouse',
    'Search Infrastructure','Notification Service','Identity Provider','Admin Console','Design System',
    'Analytics Pipeline','Payment Gateway','Inventory Sync','Order Management','Customer Portal',
    'Fraud Detection','Email Delivery','Image Processing','Recommendation Engine','Audit Service',
    'Feature Flags','Content Management','Partner Integrations','Reporting Suite','Shipping Rates',
    'Tax Engine','Subscription Billing','Warehouse Robotics','Returns Portal','Loyalty Program',
    'Price Optimisation','Supplier Directory','Checkout Flow','Session Store','Config Service',
    'Log Aggregation','Chat Support','Document Signing','Localization','Onboarding Flow',
    'Rate Limiter','Backup Orchestrator','Compliance Reports','Developer Portal'
  ];

  proj_keys text[] := array[
    'WEB','API','MOB','BILL','DW','SRCH','NOTIF','IDP','ADM','DS',
    'PIPE','PAY','INVSY','ORD','PORT','FRAUD','MAIL','IMG','RECO','AUD',
    'FLAG','CMS','PART','RPT','SHIP','TAX','SUBS','ROBO','RET','LOYAL',
    'PRICE','SUPP','CHK','SESS','CFG','LOGS','CHAT','SIGN','I18N','ONB',
    'RATE','BKP','COMP','DEV'
  ];

  proj_descs text[] := array[
    'Customer-facing storefront and account pages',
    'REST and GraphQL surface for partners and internal clients',
    'iOS and Android clients, sharing a React Native core',
    'Invoicing, dunning and revenue recognition',
    'Nightly ETL into the columnar store',
    'Query parsing, indexing and relevance tuning',
    'Email, SMS and push fan-out with per-channel retries',
    'OIDC provider, session management and MFA',
    'Internal tooling for support and operations',
    'Shared component library and design tokens',
    'Event ingestion, enrichment and downstream sinks',
    'Card, wallet and bank-transfer processing',
    'Two-way stock sync with supplier systems',
    'Order lifecycle from cart to fulfilment',
    'Self-service portal for enterprise customers',
    'Real-time scoring of transactions and signups',
    'Transactional mail templating and delivery',
    'Upload, transcode and CDN distribution',
    'Personalised product ranking',
    'Immutable activity history across services',
    'Runtime configuration and staged rollouts',
    'Editorial workflow for marketing pages',
    'Connectors for ERP and marketplace partners',
    'Scheduled and ad-hoc business reporting',
    'Carrier rate shopping and label generation',
    'Multi-jurisdiction tax calculation',
    'Plans, seats, proration and trials',
    'Pick-and-pack automation on the warehouse floor',
    'Customer-initiated returns and refunds',
    'Points accrual, tiers and redemption',
    'Elasticity modelling and markdown planning',
    'Vendor records, contracts and onboarding',
    'Cart, payment capture and order confirmation',
    'Distributed session and cache layer',
    'Central configuration with audited changes',
    'Structured logging, retention and search',
    'Live chat routing and agent tooling',
    'E-signature workflows for contracts',
    'Translation pipeline and locale rollout',
    'First-run experience and activation',
    'Per-tenant quota enforcement at the edge',
    'Scheduled backups and restore drills',
    'Evidence collection for SOC 2 and GDPR',
    'API documentation, keys and sandboxes'
  ];

  -- Title templates. Crossed with an area below, these produce a backlog that
  -- reads like a real one rather than "Issue 1 … Issue 690". No template
  -- supplies an article: every area carries its own.
  templates text[] := array[
    'Fix %s timeout under sustained load',
    '%s returns 500 on an empty payload',
    'Add retry with backoff to %s',
    'Reduce %s cold start time',
    'Migrate %s off the deprecated client',
    'Memory leak in %s after 24h uptime',
    '%s ignores the tenant scope on bulk reads',
    'Paginate %s response',
    'Add structured logging to %s',
    '%s silently swallows validation errors',
    'Cache %s lookups per request',
    'Race condition when %s runs concurrently',
    'Backfill missing rows in %s',
    '%s breaks when the payload exceeds 1MB',
    'Add an index for %s hot path',
    'Rate limit %s per organization',
    '%s drops the correlation id',
    'Handle partial failure in %s',
    'Document %s contract',
    '%s does not honour the Retry-After header',
    'Flaky test around %s',
    'Deduplicate %s events',
    'Expose %s metrics to Prometheus',
    '%s should be idempotent',
    'Alert on %s error rate',
    'Move %s to the async queue',
    '%s leaks connections on error',
    'Add a dry-run mode to %s',
    'Validate %s input at the boundary',
    'Roll %s behind a feature flag',
    '%s returns stale data after a write',
    'Support cursor pagination in %s',
    'Tighten %s permission check',
    '%s fails silently when the upstream is down',
    'Add a circuit breaker to %s',
    'Compress %s payloads over the wire',
    '%s misreports the row count',
    'Batch %s writes',
    'Time-box %s rollout',
    'Redact PII from %s logs'
  ];

  areas text[] := array[
    'the export job','the webhook dispatcher','the search indexer','the invoice renderer',
    'the session refresh','the CSV importer','the audit writer','the image resizer',
    'the pricing rules engine','the tax lookup','the label printer','the stock reconciler',
    'the reporting query','the digest mailer','the sitemap generator','the SSO callback',
    'the checkout summary','the returns workflow','the loyalty accrual','the fraud scorer',
    'the config reload','the schema migration','the metrics collector','the token exchange',
    'the batch uploader','the notification fan-out','the cart merge','the address validator',
    'the currency converter','the PDF exporter','the partner sync','the rate limiter',
    'the backup restore','the log shipper','the flag evaluator','the translation loader'
  ];

  detail text[] := array[
    'Reproduced on staging with production-shaped data. Happens roughly one request in forty, always under concurrency.',
    'Only shows up for organizations above ~10k rows, which is why it escaped the original review.',
    'Started after the client library upgrade last month. Rolling back makes it go away.',
    'The upstream returns a 200 with an error body, so the current code treats it as success.',
    'Customer-reported. Two enterprise accounts have hit it this week; support has the ticket numbers.',
    'Found while profiling. Not user-visible yet, but it will be once traffic doubles.',
    'The retry storm makes it worse rather than better — each attempt takes a fresh connection.',
    'Needs a decision on whether to fix forward or revert before we schedule it.',
    'Blocked on the platform team finishing the queue migration.',
    'Straightforward once the index lands; the query plan is already understood.'
  ];

  statuses public.issue_status[] := array['backlog','backlog','backlog','todo','todo','todo',
    'in_progress','in_progress','in_review','done','done','done','cancelled'];
  priorities public.issue_priority[] := array['none','none','low','low','low','medium','medium',
    'medium','medium','high','high','urgent'];

  pool uuid[];
  project_ids uuid[];
  pid uuid;
  i int;
  n_issues int;
begin
  -- People -------------------------------------------------------------------
  for i in 1 .. member_count loop
    insert into public.memberships (org_id, user_id, role)
    values (
      target_org,
      private.demo_user(
        lower(translate(people[name_offset + i], ' ', '.')) || '@' || email_domain,
        people[name_offset + i]
      ),
      roles[1 + (i % array_length(roles, 1))]
    );
  end loop;

  -- Everyone in the organization, including whoever was already there, so
  -- assignees in a populated Acme include the seeded accounts.
  select array_agg(user_id) into pool
    from public.memberships where org_id = target_org;

  -- Projects -----------------------------------------------------------------
  for i in proj_from .. proj_to loop
    insert into public.projects (org_id, name, key, description, created_by, created_at)
    values (
      target_org, proj_names[i], proj_keys[i], proj_descs[i],
      pool[1 + ((i * 5) % array_length(pool, 1))],
      now() - ((400 - i * 6) || ' days')::interval
    )
    returning id into pid;

    project_ids := array_append(project_ids, pid);
  end loop;

  -- A few archived, so the projects screen has both states to render.
  update public.projects
     set archived_at = now() - interval '20 days'
   where org_id = target_org
     and key in ('ROBO','I18N','SIGN');

  -- Issues -------------------------------------------------------------------
  -- Weighted so the big projects carry most of the backlog, which is what makes
  -- per-project filtering worth trying.
  for i in 1 .. array_length(project_ids, 1) loop
    n_issues := case when i <= 6 then 45 when i <= 16 then 22 else 8 end;

    insert into public.issues (
      org_id, project_id, title, description, status, priority,
      assignee_id, created_by, created_at, updated_at
    )
    select
      target_org,
      project_ids[i],
      -- Capitalised because roughly half the templates start with the area
      -- itself, which would otherwise read lowercase.
      --
      -- Built in the lateral below rather than in a scalar subquery here. An
      -- uncorrelated subquery is hoisted to an InitPlan and evaluated *once per
      -- statement* — the same caching the RLS policies rely on deliberately —
      -- so every issue in a project came out with an identical title.
      upper(left(t.raw_title, 1)) || substr(t.raw_title, 2),
      case when random() < 0.62
        then detail[1 + floor(random() * array_length(detail, 1))::int]
        else null
      end,
      statuses[1 + floor(random() * array_length(statuses, 1))::int],
      priorities[1 + floor(random() * array_length(priorities, 1))::int],
      -- Roughly a quarter unassigned, so the "Unassigned" filter has something
      -- to find and the assignee picker has an empty state to show.
      case when random() < 0.74
        then pool[1 + floor(random() * array_length(pool, 1))::int]
        else null
      end,
      pool[1 + floor(random() * array_length(pool, 1))::int],
      t.created,
      -- The list sorts on updated_at, so it has to vary too or the ordering is
      -- whatever the heap happens to return.
      t.created + (floor(random() * 20) || ' days')::interval
    from generate_series(1, n_issues) as g
    cross join lateral (
      select
        now() - (floor(random() * 300) || ' days')::interval
              - (floor(random() * 86400) || ' seconds')::interval as created,
        format(
          templates[1 + floor(random() * array_length(templates, 1))::int],
          areas[1 + floor(random() * array_length(areas, 1))::int]
        ) as raw_title,
        -- Referencing g keeps the lateral correlated, so the planner cannot
        -- pull it out and evaluate it once for the whole insert.
        g as row_no
    ) t;
  end loop;

  -- Audit history ------------------------------------------------------------
  -- The triggers wrote a row per project and per membership, but with
  -- actor_id null (auth.uid() is null outside a request) and all at the same
  -- instant. Both are artefacts of loading data this way, so they are fixed up
  -- rather than left looking like the audit log is broken.
  --
  -- Scoped to rows this run just created: `actor_id is null` is what the seed's
  -- own entries look like too, and those belong to the fixture.
  update public.audit_log a
     set actor_id = pool[1 + floor(random() * array_length(pool, 1))::int],
         created_at = now() - (floor(random() * 260) || ' days')::interval
                            - (floor(random() * 86400) || ' seconds')::interval
   where a.org_id = target_org
     and a.actor_id is null
     and a.created_at > now() - interval '5 minutes';
end;
$$;

-- ----------------------------------------------------------------------------
-- Clean out anything a previous run left behind
-- ----------------------------------------------------------------------------

-- Note there is deliberately no `session_replication_role = replica` here, which
-- is the usual trick for quiet bulk loading. It disables *all* triggers,
-- including the system ones implementing `on delete cascade`, so the Northwind
-- delete below removed the organization row and orphaned every project under
-- it — which then collided on the next run.
do $$
declare
  acme uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  -- Everything except WEB and API, which the seed owns.
  demo_keys text[] := array[
    'MOB','BILL','DW','SRCH','NOTIF','IDP','ADM','DS',
    'PIPE','PAY','INVSY','ORD','PORT','FRAUD','MAIL','IMG','RECO','AUD',
    'FLAG','CMS','PART','RPT','SHIP','TAX','SUBS','ROBO','RET','LOYAL',
    'PRICE','SUPP','CHK','SESS','CFG','LOGS','CHAT','SIGN','I18N','ONB',
    'RATE','BKP','COMP','DEV'
  ];
  demo_users uuid[];
begin
  -- Northwind is entirely ours, so the whole tenant goes. This only works
  -- because the cascade triggers now tell a teardown from an ordinary edit —
  -- see the 20260824070000 migration.
  delete from public.organizations where slug = 'northwind';
  delete from auth.users where email like '%@northwind.test';

  -- Acme is shared with the seed, so only the demo's own rows go. Note who they
  -- are before removing them, since the audit entries are matched by id.
  select array_agg(id) into demo_users
    from public.profiles where email like '%@team.acme.test';

  -- Issues cascade with their project.
  delete from public.projects where org_id = acme and key = any(demo_keys);

  -- Pending invitations are unique per (org, email), so leaving these behind
  -- makes the next run fail on a duplicate rather than replace them.
  delete from public.invitations where org_id = acme and email like '%@team.acme.test';

  delete from auth.users where email like '%@team.acme.test';

  -- Audit entries last, because the three deletes above each *write* more of
  -- them — project.deleted and member.removed. Cleaning first would leave a
  -- fresh set behind on every run.
  delete from public.audit_log
   where org_id = acme
     and (
          (target_type = 'project'    and metadata->>'key' = any(demo_keys))
       or (target_type = 'membership' and (metadata->>'user_id')::uuid = any(demo_users))
     );
end;
$$;

-- ----------------------------------------------------------------------------
-- Load
-- ----------------------------------------------------------------------------

do $$
declare
  org_nw uuid := 'd0000000-d000-4000-8000-000000000001';
  founder uuid;
begin
  -- Seeded, so the generated content — titles, statuses, priorities, who is
  -- assigned what — is the same on every run. Row ids still differ, since they
  -- come from gen_random_uuid().
  perform setseed(0.4242);

  -- Acme: additive. Projects 3..44 (WEB and API are the seed's), 60 more
  -- people, and names taken from the back of the pool so the two organizations
  -- are staffed by different people.
  perform private.demo_populate(
    target_org   => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    proj_from    => 3,
    proj_to      => 44,
    email_domain => 'team.acme.test',
    member_count => 60,
    name_offset  => 68
  );

  insert into public.invitations (org_id, email, role, invited_by) values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contract.qa@team.acme.test', 'viewer',
     '22222222-2222-2222-2222-222222222222'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ops.lead@team.acme.test', 'admin',
     '22222222-2222-2222-2222-222222222222');

  -- Northwind: a whole tenant of its own. The founder is created first because
  -- organizations_add_owner keys off created_by to grant the owner membership.
  founder := private.demo_user('dana.whitfield@northwind.test', 'Dana Whitfield');

  insert into public.organizations (id, slug, name, created_by)
  values (org_nw, 'northwind', 'Northwind Trading', founder);

  perform private.demo_populate(
    target_org   => org_nw,
    proj_from    => 1,
    proj_to      => 44,
    email_domain => 'northwind.test',
    member_count => 67,
    name_offset  => 1
  );

  -- A second owner, so the owner-only screens are worth looking at as someone
  -- other than the founder.
  update public.memberships
     set role = 'owner'
   where org_id = org_nw
     and user_id = (select id from public.profiles where email = 'marcus.bello@northwind.test');
end;
$$;

drop function private.demo_populate(uuid, int, int, text, int, int);
drop function private.demo_people();
drop function private.demo_user(text, text);

commit;

-- What landed.
select o.name,
       (select count(*) from public.memberships m where m.org_id = o.id) as members,
       (select count(*) from public.projects   p where p.org_id = o.id) as projects,
       (select count(*) from public.issues     i where i.org_id = o.id) as issues,
       (select count(*) from public.audit_log  a where a.org_id = o.id) as audit
  from public.organizations o
 where o.slug in ('acme', 'northwind')
 order by o.name;
