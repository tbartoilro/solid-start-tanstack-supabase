# PROJECT.md — the workbench

**Read this first.** It is the single source of truth for what this project is becoming,
what is done, and what to do next. Update it in the same commit as the work it describes.

---

## What this is

A **multi-tenant SaaS dashboard** on SolidStart 2 + `@tanstack/solid-router` + Supabase +
Park UI, with a four-layer server and Postgres RLS. It works, it is tested, and it is the
reference implementation.

**Where it is going:** a Django-admin-like **framework** — point it at an existing Postgres
schema and get org-scoped CRUD dashboards, generated from the tables and hand-editable
afterwards. The app you see today becomes the framework's reference app and test harness.

Design rationale lives in `README.md` (architecture) and the six skills under `skills/`.
Read `skills/template-architecture/SKILL.md` before touching server code.

---

## Status

| Phase | State |
|---|---|
| 0. Monorepo migration | ☐ not started |
| 1. `packages/core` — descriptor types | ☐ not started |
| 2. `packages/server` — generic query layer + server-side sorting | ☐ not started |
| 3. `DataTable` component (TanStack v8) | ☐ not started |
| 4. Bulk actions + audit CSV | ☐ not started |
| 5. `packages/codegen` — introspection CLI | ☐ not started |
| 6. `packages/cli` — component scaffolding | ☐ not started |

**Last known-green baseline:** `f1af2eb` (tag `v0.1.0-reference`, 2026-08-24) — typecheck clean · vitest 67/67 · Playwright 69/69.

---

## Decisions already made — do not relitigate

| Decision | Choice | Why |
|---|---|---|
| Repo layout | Monorepo, same repo: `apps/reference` + `packages/*` | The reference app is the framework's test harness; it must break in the same CI run the framework breaks. Monorepo → split later is easy; two repos → merge later is painful. |
| UI distribution | A CLI scaffolds components **into** the consumer's app (shadcn / Park UI style) | Sidesteps Panda content-glob and Solid-JSX-in-a-package problems entirely. Consumers own and edit their components, as they already do with Park UI. |
| Resource config | Generated TypeScript descriptors, hand-edited after generation | Type-safe, reviewable in git, regenerable. Mirrors the existing `db:types` pipeline. |
| Build tooling | npm workspaces now, Turborepo later | Keeps `package-lock.json` and existing scripts working. Add Turbo when there are build steps worth caching. |
| Table library | `@tanstack/solid-table@8` — **not v9** | npm `latest` is 9.1.2, but v9's Solid adapter is undocumented: the official docs at `/table/latest/docs/framework/solid/` still describe the v8 API. For a repo meant to be read and copied, matching the docs a reader will find beats being on the newest major. |
| Bulk selection | Persists across pages, keyed by row id | Lists run to 28 pages; per-page selection makes bulk work useless. |
| Audit log | Read-only, bulk-select → CSV | Postgres enforces this: `audit_log` is granted `select` only and has no insert/update/delete policy. |

---

## Rules that must not be broken

These are load-bearing. Each one has a bug behind it.

1. **`"use server"` compiles to a public HTTP endpoint.** Route guards and `<Can>` are UX
   only. The real check is `authorize()` in `src/server/guard.ts` plus RLS. Prove every
   refusal with `callRpc` (`e2e/helpers.ts`), never by asserting a hidden button.
2. **Never pass a client-supplied column name to `.order()`.** PostgREST's `order=` accepts
   embedded paths and comma-separated lists (`projects.name`, `a.desc,b.asc`), so escaping
   is not a defence — an **allowlist resolved to a literal** is. See Phase 2.
3. **Never sort or filter a paginated list client-side.** It acts on the 25 loaded rows,
   looks right, and is wrong. Two shipped bugs came from exactly this.
4. **Every `<Table.Cell>` carries exactly one** of `data-label="X"` / `data-label`+`data-block`
   / `data-primary` / `data-actions`. Below `lg` these drive the card layout. A cell with
   none renders as an unlabelled orphan.
5. **Keep the ARIA roles** in `src/components/ui/table.tsx`. Changing a table element's
   `display` strips its implicit role in every browser, and e2e uses `getByRole("table")`.
6. **Portal every Dialog/Menu/Select positioner** — except a Select already inside a Dialog,
   which must stay inside the focus trap.
7. **Per-row accessible names are required** (`aria-label={\`Edit ${issueKey(row)}\`}`). A
   table of N identical "Edit" buttons is unusable with a screen reader and ambiguous to
   any locator; tests depend on them.
8. **Don't edit files while a Playwright run is in flight.** Vite restarts the SSR worker
   and you get a spurious `Vite environment "ssr" is unavailable` 503.

---

## Environment

```bash
npm run db:start          # Supabase (Docker). Ports 54321/54322 are exclusive —
                          # only one Supabase project can run at a time.
npm run db:reset          # migrations + seed. Required before the RLS tests:
                          # they assert seed-exact contents.
npm run db:demo           # OPTIONAL load fixture: Acme gets 44 projects / 703
                          # issues / 64 members, plus a second tenant, Northwind.
npm run verify            # typecheck + vitest + playwright
```

- **NixOS:** Playwright's bundled Chromium cannot launch. `shell.nix` sets `CHROMIUM_PATH`;
  outside the nix shell prefix commands with
  `CHROMIUM_PATH=/run/current-system/sw/bin/chromium`.
- Seeded accounts use password `password123`: `owner@`/`admin@`/`member@`/`viewer@acme.test`,
  `outsider@globex.test`. With demo data loaded, also `dana.whitfield@northwind.test`.
- Run the suite **without** demo data unless you are testing volume — a few tests locate a
  seeded row on the first page of a list, which the demo data buries.

---

## Phases

### Phase 0 — Monorepo migration

Two commits: one that only moves files, one that only fixes configuration.

- [ ] Tag the flat reference: `git tag -a v0.1.0-reference && git push origin v0.1.0-reference`
- [ ] Record a green baseline (typecheck + vitest + playwright counts) in **Status** above
- [ ] `git mv` app → `apps/reference/` (see the table below for what moves)
- [ ] Root `package.json` → workspace root; app scripts scoped to the workspace
- [ ] Fix each breakage below; `npm run verify` must return the same counts

**What moves to `apps/reference/`:** `src/ e2e/ supabase/ public/ panda.config.ts
vite.config.ts vitest.config.ts playwright.config.ts postcss.config.cjs tsconfig.json
components.json package.json Dockerfile .env.example .env.test`
(plus untracked `styled-system/` and `.env` via plain `mv` — they are gitignored).

**What stays at root:** `README.md CHECKLIST.md PROJECT.md LICENSE shell.nix skills/
.claude-plugin/ .github/ .gitignore package-lock.json`

| Breakage | Fix |
|---|---|
| `prepare: panda codegen` | npm runs `prepare` at the **root**. Without codegen there is no `styled-system/` and everything fails. Verify workspace `prepare` runs on a clean `npm install`; add a root passthrough if not. |
| `styled-system` alias in **3** files (`vite.config.ts`, `tsconfig.json`, `vitest.config.ts`) | All relative and move with their config, so they *should* survive — but the vite alias exists because the app typechecked clean and died at **runtime** without it. Verify by running the app, not `tsc`. |
| `.gitignore` anchored paths | `supabase/.branches/`, `supabase/.temp/`, `e2e/.auth/` contain a slash and so are anchored to the repo root. Re-point at `apps/reference/…`. (`styled-system/`, `test-results/`, `node_modules/` match at any depth — leave them.) |
| `db:demo` script | Greps `supabase/config.toml` for the container name. Must run with cwd = `apps/reference`. |
| `.github/workflows/ci.yml` | `supabase start`, `npm run typecheck/test/test:e2e/build` all assume root. Add `working-directory: apps/reference` or route through root passthrough scripts. |
| `Dockerfile` | `COPY . .` + `npm ci` + `npx panda codegen` + `npm run build` assume a flat root. Make workspace-aware. |
| `skills/**/SKILL.md` | ~175 citations of `src/…`, `e2e/…`, `supabase/…`. Sweep to `apps/reference/…`. These are the onboarding doc for the next Claude — stale paths make them worse than nothing. |

### Phase 1 — `packages/core`: the descriptor

Plain TypeScript. **No JSX, no Panda, no Supabase import** — it is imported by both client
and server.

- [ ] `ResourceColumn` / `ResourceDescriptor` types + `defineResource()` with `TRow` inference
- [ ] The four escape hatches, each justified by a real screen:
  `cell` (renderer with page context), `visible` (row-aware predicate returning
  `true|false|"disabled"`), `fallback` (per-column denied JSX), `cellProps`/`headerProps`
- [ ] Descriptors for the screens that fit

**The descriptor deliberately does NOT own** filter UI, create surfaces, cache-invalidation
policy, or page-level furniture. Those are genuinely different on all five screens; keeping
them out is what stops the abstraction becoming worse than hand-written code.

### Phase 2 — `packages/server`: generic query layer

- [ ] Descriptor → validated zod list schema (page/pageSize/sort/dir) + PostgREST query
- [ ] **Sort allowlist**, the security boundary: `z.enum([...sortableIds])`, then resolve the
      id to a physical column *through the descriptor* — never pass the input string on
- [ ] Reuse the existing LIKE escape: `replace(/[%_\\]/g, m => \`\\${m}\`)`
- [ ] Migration adding indexes for every column declared sortable
- [ ] e2e: a `callRpc` test asserting a smuggled sort value (`title,id`, `projects.name`)
      is refused

**Endpoint shape:** per-resource RPC files calling shared builders — *not* one generic
`listResource({resource,…})`. The repo's principle is a thin, explicit trust boundary where
you can read an endpoint and see what it requires. A generic endpoint that looks its
permission up from a registry turns a registry bug into an authorization bug.

**Sortability implies an index.** `audit_log`'s only index is `(org_id, created_at desc)`;
`issues` has none on `updated_at` despite that being its default sort.

### Phase 3 — `DataTable`

- [ ] Component driving the existing Park UI markup from a TanStack v8 instance
- [ ] `manualPagination` / `manualSorting` / `manualFiltering` all `true`
- [ ] `getRowId: row => String(row[idColumn])`
- [ ] Sort state in the URL (`sort`/`dir` search params with `.catch()` defaults), so a
      sorted list is linkable — consistent with how `page` already works
- [ ] Sortable column headers
- [ ] `e2e/responsive.spec.ts` passes **unchanged**

### Phase 4 — Bulk actions

- [ ] Selection `Record<rowId, true>` above the table, surviving page and filter changes
- [ ] Action bar: "N selected" + Clear
- [ ] Per-resource bulk RPC. **`idSchema` is `z.guid()` for uuid resources but
      `z.coerce.number().int()` for `audit_log`** — it is `bigserial`, the only such table.
- [ ] issues: delete / set status / assign · projects: delete / archive ·
      members: remove / change role
- [ ] Members bulk must still refuse self-edits, owner-minting, and last-owner removal
      (`services/members.ts` + a database trigger)
- [ ] Audit CSV: no serialiser exists yet; reuse the client-side Blob download idiom in
      `settings.tsx`, flatten `metadata` to a string, rate-limit as `org-export` is
- [ ] Refusals asserted at the endpoint via `callRpc`

### Phase 5 — `packages/codegen`

Introspection verified viable against the live DB.

| Signal | Infers |
|---|---|
| has an `org_id` column | that it is a tenant resource — finds exactly `audit_log, invitations, issues, memberships, projects` |
| `typtype='e'` + `pg_enum` | a filter dropdown **with its options** |
| FK target | relation column, join + label |
| type / `attnotnull` | cell formatting, sortability, required-ness |

**Not inferable:** the permission mapping (`memberships` → `members.*`, `audit_log` →
`audit.read`). Emit a `TODO` where the generator guessed — that is what generate-then-edit
is for.

### Phase 6 — `packages/cli`

`npx <framework> add table` copies components into the consumer's `src/components`.
**Do not design this until Phases 3–4 are green** in the reference app.

---

## Risks, ranked

1. **Panda / `styled-system` across the move.** The alias lives in three configs because the
   app typechecked clean and failed at runtime. Prove it by running the app. Gates everything.
2. **The abstraction becoming worse than the hand-written screen.** The five screens contain
   real irregularity: row-aware permission predicates (`writer OR this row's assignee`),
   three different denied-cell fallbacks, a cell whose content comes from a *different
   query*, a breakpoint-dependent width budget that belongs to the table not the column.
   **If a screen fights the descriptor, keep the screen.** A framework you cannot opt out of
   is a worse framework.
3. **The sort allowlist.** A regression here is a security bug, not a UI bug.
4. **Unindexed sorts** at 700+ rows per tenant.
5. **Scope.** Phases 3–4 are shippable on their own. Do not start 5 before they are green.

---

## Conventions

- **Commits:** imperative subject saying what changed and why; body explains the reasoning
  and the bug behind it. Split by concern — never `git add -A` across unrelated work.
- **Tests:** assert rendered state, not just the URL. Wait for real content before asserting
  an absence. Never weaken an assertion to make a suite green.
- **Comments:** explain *why*, especially for anything non-obvious. Match the surrounding
  density.
