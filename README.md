# Multi-tenant RBAC dashboard — SolidStart 2 + TanStack Router + Supabase

A reference implementation of a production-shaped dashboard, built to answer one
question in particular: **what logic belongs on the server, and why.**

The domain is a multi-tenant issue tracker — organizations contain projects,
projects contain issues, users hold a per-organization role, and roles map to
fine-grained permissions. That shape was chosen deliberately: it forces every
interesting authorization question (tenant isolation, privilege escalation,
permission granularity) instead of letting a CRUD demo dodge them.

```
Node 26 · SolidStart 2.0.2 · @tanstack/solid-router 1.170 · @tanstack/solid-query 5
Supabase (local CLI) · Postgres RLS · Zod 4 · Panda CSS (ready for Park UI)
```

---

## Quick start

```bash
npm install
cp .env.example .env          # local Supabase defaults, identical on every machine

npm run db:start              # supabase start (needs Docker)
npm run db:reset              # apply migrations + seed
npm run db:types              # regenerate src/lib/database.types.ts

npm run dev                   # http://localhost:4321
```

Seeded accounts, all with password `password123`:

| Email | Org | Role |
|---|---|---|
| `owner@acme.test` | Acme | owner |
| `admin@acme.test` | Acme | admin |
| `member@acme.test` | Acme | member |
| `viewer@acme.test` | Acme | viewer |
| `outsider@globex.test` | Globex | owner |

Globex exists so tenant isolation is testable: nothing an Acme user does should
ever reach it.

---

## The architecture, in one page

### Why this stack combination works

SolidStart's own router is `@solidjs/router`; here it is replaced by
`@tanstack/solid-router`. This is a supported pairing, not a hack — SolidStart 2
is explicitly router-agnostic, and `createHandler` takes a third argument for
exactly this purpose:

```ts
createHandler(fn, options, routerLoad?: (event: FetchEvent) => Promise<void>)
```

`routerLoad` runs **after middleware but before the page event and before
render**, which produces the ordering the whole design depends on:

```
1. middleware      populates event.locals (session, active org)
2. routerLoad      matches the route and runs its loaders   ← src/entry-server.tsx
3. render          app.tsx reads the already-loaded router
```

Because loaders run at step 2, their data is in the first byte of HTML rather
than arriving after hydration. `StartClientTanstack` (not `StartClient`) is
required on the client so the tree depth matches what the server rendered.

The two filesystem routers are kept apart by pointing SolidStart's at a
different directory: `src/api/**` is SolidStart's (HTTP endpoints only), and
`src/routes/**` belongs entirely to TanStack Router.

**Loader data transfer is not automatic.** TanStack Router's own SSR payload
mechanism is not in play when SolidStart owns the document, so out of the box
every loader re-runs on hydration. TanStack Query is the transfer vehicle:
loaders go through `ensureQueryData`, the server inlines the dehydrated cache as
`#__QUERY_STATE__`, and the client rehydrates before mounting. `npm run
verify:ssr` asserts zero server-function calls on hydration.

### Server responsibility, in four layers

Each layer has one job and is not allowed to do the next one's.

| Layer | Location | Responsibility | Explicitly NOT its job |
|---|---|---|---|
| **1. Request middleware** | `src/middleware.ts` | Build a per-request Supabase client, verify the session, resolve the active org, populate `event.locals`. | Any business logic. Any authorization decision. |
| **2. RPC boundary** | `src/server/rpc/*` | The trust boundary. Validate input, **enforce permission**, translate errors. Thin. | Business rules, SQL. |
| **3. Domain services** | `src/server/services/*` | Pure logic over an explicit `AuthContext`. Unit-testable with no server. | Reading cookies, deciding who the caller is. |
| **4. Data + RLS** | Supabase client + `supabase/migrations/` | Queries, and the database-level backstop. | Being the only line of defense. |

### Defense in depth — the point of the whole repo

Three independent checks, because the first one is not security at all:

1. **Route guards (`beforeLoad`) are UX only.** They prevent an auth flash and
   issue redirects. A `"use server"` function compiles to a plain HTTP endpoint
   that anyone can `POST` directly, with no router involved. Delete every guard
   and the app looks broken but leaks nothing.

2. **Server-function middleware is the real enforcement point.** Every
   tenant-scoped RPC runs through `authorize()` in `src/server/guard.ts`, in a
   fixed order: *validate → scope to tenant → authorize → handle*.

3. **RLS is the backstop.** Every table has RLS on, scoped by `org_id`. If
   layers 1–2 are ever wrong, the database still refuses.

`npm run verify:app` proves point 1 by importing the RPC stubs straight from the
page and calling them — exactly what a user with devtools open can do.

### RBAC: JWT for speed, database for truth

Two mechanisms, with a deliberate rule about which is authoritative.

- A **Custom Access Token Hook** stamps the user's memberships into the JWT as an
  `orgs` claim. Read with zero database round-trips, used for **rendering** and
  for cheap scope checks on every request.
- **`private.authorize(permission, org_id)`** — a `security definer` function
  reached through the `public.has_permission()` wrapper — is the authority for
  **every write and every sensitive read**.

The split exists because **JWT claims go stale**. Revoking a role does not
invalidate already-issued tokens, so a demoted user keeps the old claim until
their token refreshes (up to an hour by default). A stale claim may briefly
render a button that should be gone; it can never authorize a mutation.

RLS policies follow Supabase's performance guidance — helper calls wrapped in a
sub-select so the planner caches them as an `InitPlan` instead of re-running per
row, and every policy-referenced column indexed:

```sql
create policy "projects: read" on public.projects for select
  using ( (select private.authorize('projects.read', org_id)) );
create index projects_org_id_idx on public.projects using btree (org_id);
```

Helper functions live in a `private` schema, which is not in PostgREST's exposed
schema list — that, not privilege revocation, is what stops clients calling them.
`authenticated` must *keep* `USAGE` and `EXECUTE` there, because an RLS policy
expression is evaluated with the privileges of the querying role.

### Invariants live in the database

Anything that would be a security or integrity bug if an application path forgot
it is a trigger, not service code:

- profile creation on signup (covers every signup path, not just implemented ones)
- owner membership on org creation (otherwise the founder is locked out)
- per-project issue numbering under an advisory lock
- last-owner protection
- audit writes — `SECURITY DEFINER`, and the audit table has **no INSERT policy
  at all**, so history cannot be forged or rewritten by anyone, including an owner

### Other decisions worth noting

- **Auth cookies are `httpOnly`.** No Supabase client runs in the browser holding
  a session, so an XSS bug cannot exfiltrate tokens. All data access is via
  server functions, so nothing is lost.
- **`getClaims()`, not `getSession()`**, on the server: the latter trusts the
  cookie without verifying it.
- **Reads that fail authorization return 404, not 403.** A 403 confirms the
  resource exists, which lets one tenant map another's data by probing ids.
- **`serverFunctions.onError`** sanitizes anything thrown before it reaches the
  client: deliberate `AppError`s pass through, everything else is logged in full
  server-side and replaced with a generic message.
- **Permissions are read from `role_permissions`**, never mirrored in TypeScript,
  so the UI cannot disagree with the database about what a role may do.

### Hardening

- **Structured, request-scoped logging** (`src/server/log.ts`) — every line
  carries the `requestId` from middleware, so an RPC call, the database error it
  caused and the response the user saw can be stitched together from logs alone.
  Sensitive keys are redacted before they reach a sink.
- **Rate limiting** (`src/server/rate-limit.ts`) on sign-in (per account *and*
  per address), sign-up, and invites (per organization, since an account with
  `members.invite` is otherwise a spam relay). In-memory and therefore
  per-process — documented as a speed bump, not an exact global limit.
- **Strict CSP with per-request nonces**, production only. Two design decisions
  make it possible without escape hatches: `serialization.mode` is `"json"` so
  payloads are parsed rather than evaluated (no `'unsafe-eval'`), and no Supabase
  client runs in the browser so `connect-src` stays `'self'`. Verified: the app
  hydrates and functions under the policy, not merely that the header is present.

### Deployment

The built server reads real environment variables — it does **not** load `.env`.
`VITE_`-prefixed values are inlined at build time; `SUPABASE_SECRET_KEY` must be
present in the process environment at boot:

```bash
npm run build
SUPABASE_SECRET_KEY=... NODE_ENV=production PORT=3000 node .output/server/index.mjs
```

Env validation runs at module load, so a missing variable fails loudly on
startup rather than surfacing later as a confusing runtime error.

Output is a Nitro build, so the usual presets (Node, Vercel, Cloudflare,
Netlify) apply via Nitro configuration.

---

## Verification

```bash
npm run verify        # typecheck + all three suites
```

| Command | What it proves |
|---|---|
| `npm test` | Pure policy logic with no server or database: the full role-escalation matrix and per-org permission scoping. 28 tests. |
| `npm run verify:rbac` | RLS, tenant isolation and the JWT hook, hit through PostgREST with real tokens and **the app not running**. 19 checks. |
| `npm run verify:ssr` | Authenticated loader data is in the server's bytes, hydration refetches nothing, client nav does not reload. 7 checks. |
| `npm run verify:app` | The app end-to-end, including calling RPC endpoints directly to bypass every route guard. 19 checks. |

The two browser suites need headless Chromium with a debug port:

```bash
chromium --headless=new --remote-debugging-port=9222 &
```

> **If a suite fails oddly, check for orphaned dev servers first.** Vite silently
> moves to the next free port when 4321 is taken, so a stale process will happily
> serve your tests a previous build:
> `ps -eo pid,args | grep "[v]ite dev"`

---

## Adding Park UI

Panda CSS is configured and codegen'd; the Park UI CLI is the remaining step.

```bash
npx @park-ui/cli init          # framework: solid
npx panda codegen
npx @park-ui/cli add button card table select badge dialog
```

Already in place so the CLI has nothing to fight:

- `panda.config.ts` with `jsxFramework: "solid"` and the **Remove Panda Preset
  Colors** plugin (Park UI ships its own Radix-based palette; leaving Panda's in
  place gives you two competing token sets)
- `postcss.config.cjs`, `styled-system/` codegen, and a `styled-system/*` path alias
- `@ark-ui/solid` and `lucide-solid` installed
- `src/panda.css` — the layer entry point, **not yet imported**

**The switch-over:** in `src/app.tsx`, replace `import "./app.css"` with
`import "./panda.css"`. They are not meant to coexist — Panda's preflight reset
and `app.css` fight over the same elements.

The current markup is deliberately plain and semantic (`.card`, `.table`,
`.role-badge`, `.status`), so swapping in Park UI components is a substitution
rather than a rewrite.

> `npm install` warns that esbuild's postinstall is not approved. Panda still
> works — its platform binary resolves under `@pandacss/config`. If Panda ever
> fails to load its config, run `npm approve-scripts esbuild`.

---

## Layout

```
src/
  entry-server.tsx        the routerLoad seam + dehydrated query state
  entry-client.tsx        StartClientTanstack
  router.tsx              per-request router + QueryClient factory
  middleware.ts           session verification, active org, event.locals
  app.tsx                 QueryClientProvider + RouterProvider
  api/                    SolidStart filesystem routes — HTTP endpoints only
  routes/                 TanStack Router route tree
    _authed.tsx             session gate (UX only)
    _authed/$orgSlug.tsx    tenant gate + app shell
  server/
    guard.ts              validate -> scope -> authorize -> handle
    context.ts            AuthContext, requireAuth/requireOrg/requirePermission
    errors.ts             AppError taxonomy, 404-not-403 for tenant reads
    on-error.ts           sanitizes thrown errors at the RPC boundary
    rpc/                  thin HTTP endpoints
    services/             pure domain logic
  lib/
    auth.ts               shared vocabulary, derived from generated DB types
    queries.ts            query definitions shared by loaders and components
supabase/migrations/      schema, RBAC, RLS, triggers
scripts/                  the three verification suites
```

## Known issues worked around

- **SolidStart 2.0.2 dev toolbar breaks hydration under Vite 8.** It imports a
  named export from CJS-only `source-map-js`; the resulting `SyntaxError` aborts
  the client entry graph, so pages render from SSR but never hydrate and forms
  silently do nothing. `devOverlay: false` in `vite.config.ts`. Dev-only.
- **Zod 4's `z.uuid()` rejects most database ids.** It enforces RFC 9562
  version/variant bits; a Postgres `uuid` column stores any 128-bit value. Use
  `z.guid()` for database identifiers — `z.uuid()` silently rejected every id in
  the JWT claim and made users appear to have no memberships.
