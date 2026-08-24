-- ============================================================================
-- Demo dataset: a large organization, for exercising the UI under load.
--
-- Deliberately NOT part of supabase/seed.sql. The seed is a test fixture and
-- several suites assert its exact contents — that Acme has two projects named
-- ["Public API", "Web Platform"], that owner@acme.test belongs to exactly one
-- organization. Bulking the seed up would make those assertions meaningless
-- and every future count fragile.
--
-- So this builds a separate tenant, "Northwind Trading", with its own people.
-- Acme and Globex are untouched, which means the whole suite still passes with
-- this loaded. `npm run db:reset` removes it; re-running is safe and produces
-- exactly the same data.
--
--   npm run db:demo
--   sign in as dana.whitfield@northwind.test / password123
--
-- Sized to page: 44 projects and 68 members against a page size of 25, ~750
-- issues, and enough audit history to scroll. Every account uses password123.
-- ============================================================================

begin;

-- Idempotent: drop anything a previous run created.
--
-- Organization first, then the users. Deleting the org cascades to its
-- memberships, projects, issues and audit log; deleting the users then only
-- has profiles left to cascade to. The other order fails, because removing the
-- users takes their memberships with them one at a time and the last owner's
-- removal trips protect_last_owner while the organization is still standing.
delete from public.organizations where slug = 'northwind';
delete from auth.users where email like '%@northwind.test';

-- Same shape as the seed's helper, which drops itself at the end of the seed.
create or replace function private.demo_user(user_id uuid, user_email text, display_name text)
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
  org_nw   uuid := 'd0000000-d000-4000-8000-000000000001';
  u_owner  uuid;

  -- 68 people, so the members table pages three times over at 25 a page.
  people text[] := array[
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
    'Ravi Deshpande','Marta Nowicka','Caleb Turner'
  ];

  -- Roles skew the way a real org does: mostly members, a few admins, a long
  -- tail of read-only stakeholders.
  -- No 'owner' here: the organizations_add_owner trigger already made person 1
  -- the owner, and one more is promoted explicitly below. Minting owners from a
  -- modulo would give the org six of them.
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

  -- Title templates. Combined with an area below, these produce a backlog that
  -- reads like a real one rather than "Issue 1 … Issue 750".
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

  member_ids uuid[];
  project_ids uuid[];
  pid uuid;
  uid uuid;
  i int;
  n_issues int;
begin
  -- Seeded, so the generated content — titles, statuses, priorities, who is
  -- assigned what — is the same on every run. Row ids still differ, since they
  -- come from gen_random_uuid().
  perform setseed(0.4242);

  -- People ------------------------------------------------------------------
  for i in 1 .. array_length(people, 1) loop
    uid := private.demo_user(
      gen_random_uuid(),
      lower(translate(people[i], ' ', '.')) || '@northwind.test',
      people[i]
    );
    member_ids := array_append(member_ids, uid);
  end loop;

  u_owner := member_ids[1];

  -- The organizations_add_owner trigger grants the creator the owner
  -- membership, so person 1 is deliberately not inserted again below.
  insert into public.organizations (id, slug, name, created_by)
  values (org_nw, 'northwind', 'Northwind Trading', u_owner);

  for i in 2 .. array_length(member_ids, 1) loop
    insert into public.memberships (org_id, user_id, role)
    values (org_nw, member_ids[i], roles[1 + (i % array_length(roles, 1))]);
  end loop;

  -- Two owners, not one: the owner-only screens are worth looking at as a
  -- non-founder, and the last-owner protection is only interesting when there
  -- is a second one to remove.
  update public.memberships
     set role = 'owner'
   where org_id = org_nw and user_id = member_ids[2];

  -- Projects ----------------------------------------------------------------
  for i in 1 .. array_length(proj_names, 1) loop
    insert into public.projects (org_id, name, key, description, created_by, created_at)
    values (
      org_nw, proj_names[i], proj_keys[i], proj_descs[i],
      member_ids[1 + ((i * 5) % array_length(member_ids, 1))],
      now() - ((400 - i * 6) || ' days')::interval
    )
    returning id into pid;

    project_ids := array_append(project_ids, pid);
  end loop;

  -- A few archived, so the projects screen has both states to render.
  update public.projects
     set archived_at = now() - interval '20 days'
   where org_id = org_nw
     and key in ('ROBO','I18N','SIGN');

  -- Issues ------------------------------------------------------------------
  -- Weighted so the big projects carry most of the backlog, which is what
  -- makes per-project filtering worth trying.
  for i in 1 .. array_length(project_ids, 1) loop
    n_issues := case when i <= 6 then 45 when i <= 16 then 22 else 8 end;

    insert into public.issues (
      org_id, project_id, title, description, status, priority,
      assignee_id, created_by, created_at
    )
    select
      org_nw,
      project_ids[i],
      -- Areas carry their own article ("the export job"), so a template never
      -- supplies one. Capitalised afterwards because roughly half the templates
      -- start with the area itself and would otherwise read lowercase.
      (
        select upper(left(t, 1)) || substr(t, 2)
        from format(
          templates[1 + floor(random() * array_length(templates, 1))::int],
          areas[1 + floor(random() * array_length(areas, 1))::int]
        ) as t
      ),
      case when random() < 0.62
        then detail[1 + floor(random() * array_length(detail, 1))::int]
        else null
      end,
      statuses[1 + floor(random() * array_length(statuses, 1))::int],
      priorities[1 + floor(random() * array_length(priorities, 1))::int],
      -- Roughly a quarter unassigned, so the "Unassigned" filter has something
      -- to find and the assignee picker has an empty state to show.
      case when random() < 0.74
        then member_ids[1 + floor(random() * array_length(member_ids, 1))::int]
        else null
      end,
      member_ids[1 + floor(random() * array_length(member_ids, 1))::int],
      now() - (floor(random() * 300) || ' days')::interval
                - (floor(random() * 86400) || ' seconds')::interval
    from generate_series(1, n_issues);
  end loop;

  -- Invitations -------------------------------------------------------------
  insert into public.invitations (org_id, email, role, invited_by) values
    (org_nw, 'new.engineer@northwind.test',  'member', u_owner),
    (org_nw, 'contract.qa@northwind.test',   'viewer', u_owner),
    (org_nw, 'ops.lead@northwind.test',      'admin',  u_owner);

  -- Audit history -----------------------------------------------------------
  -- The triggers wrote a row per project and per membership, but with
  -- actor_id null (auth.uid() is null under psql) and all at the same instant.
  -- Both are artefacts of loading data outside a request, so they are fixed up
  -- here rather than left looking like the audit log is broken.
  update public.audit_log a
     set actor_id = member_ids[1 + floor(random() * array_length(member_ids, 1))::int],
         created_at = now() - (floor(random() * 260) || ' days')::interval
                            - (floor(random() * 86400) || ' seconds')::interval
   where a.org_id = org_nw;
end;
$$;

drop function private.demo_user(uuid, text, text);

commit;

-- What landed.
select
  (select count(*) from public.memberships where org_id = 'd0000000-d000-4000-8000-000000000001') as members,
  (select count(*) from public.projects    where org_id = 'd0000000-d000-4000-8000-000000000001') as projects,
  (select count(*) from public.issues      where org_id = 'd0000000-d000-4000-8000-000000000001') as issues,
  (select count(*) from public.audit_log   where org_id = 'd0000000-d000-4000-8000-000000000001') as audit_entries;
