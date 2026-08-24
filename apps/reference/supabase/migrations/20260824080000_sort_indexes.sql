-- ============================================================================
-- Indexes for the columns the resource descriptors declare sortable.
--
-- Landing this before sorting is exposed, because making a column sortable
-- without an index turns one click into a scan of every row the tenant owns.
-- Three of these also cover the *existing* default sorts, which are unindexed
-- today: issues by updated_at, projects by name, memberships by created_at.
--
-- Measured, so the effect is stated accurately rather than assumed. Before:
--
--   Limit -> Sort (top-N heapsort)
--              -> Bitmap Heap Scan on issues  (actual rows=703)
--
-- 703 rows read and sorted to return 25. With the index available the ordered
-- plan exists and is dramatically better:
--
--   Limit -> Index Scan using issues_org_id_updated_at_idx  (actual rows=25)
--
-- No sort node, and it stops after 25 rows. Note the planner does *not* choose
-- it at the seed-plus-demo scale used here, and it is right not to: the whole
-- table is 344 kB and the tenant owns half of it, so a bitmap scan over 21
-- blocks costs less than random-access index lookups. The index earns its keep
-- as the table grows or as one tenant becomes a smaller share of it — which is
-- exactly the direction real data moves. Confirmed available with
-- `set enable_bitmapscan = off`.
--
-- Every index is org_id-leading, because every query is tenant-scoped first and
-- ordered second — the only column order that serves both the filter and the
-- sort. DESC is spelled out where the query is descending so the planner can
-- walk the index forwards.
--
-- Not indexed, deliberately:
--   * issues.assignee / audit_log.actor — ordered through a left-joined embed,
--     which no local index helps with.
--   * projects.open_issues — an aggregate over an embed; not sortable at all.
--   * issues.key — sorts by projects(key) then number, so the ordering happens
--     on the embedded side.
--
-- On a busy production database these should be CREATE INDEX CONCURRENTLY, run
-- outside a transaction. Plain CREATE INDEX here because the Supabase CLI wraps
-- each migration in one, and at template scale the lock is momentary.
-- ============================================================================

-- The default sort.
create index if not exists issues_org_id_updated_at_idx
  on public.issues (org_id, updated_at desc);

create index if not exists issues_org_id_title_idx
  on public.issues (org_id, title);

-- Enum ordering follows the type's declaration order (none … urgent), so this
-- sorts by real severity rather than alphabetically.
create index if not exists issues_org_id_priority_idx
  on public.issues (org_id, priority);

-- The default sort for the projects list. (org_id, key) is already covered by
-- the unique constraint.
create index if not exists projects_org_id_name_idx
  on public.projects (org_id, name);

-- The default sort for the members list.
create index if not exists memberships_org_id_created_at_idx
  on public.memberships (org_id, created_at);

-- audit_log already has (org_id, created_at desc), which is its default sort.
create index if not exists audit_log_org_id_action_idx
  on public.audit_log (org_id, action);
