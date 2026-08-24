---
name: solidstart-tanstack-seam
description: This skill should be used when working on routing, SSR or hydration in this template — "add a route", "add an API endpoint", "why did my page not update", "stale data after navigating", "the sidebar still shows the old org", "hydration mismatch", "my loader runs twice", "where does loader data come from", "it redirects me back to /login after signing in", "the form does nothing when I click it" — or whenever touching src/entry-server.tsx, src/entry-client.tsx, src/router.tsx, src/app.tsx, src/routes/**, src/api/** or the routerLoad seam.
version: 0.1.0
---

# The SolidStart / TanStack Router seam

SolidStart 2 is router-agnostic. This app drops `@solidjs/router` and drives
`@tanstack/solid-router` instead. The wiring is small, unusual, and the easiest
thing in the repo to break silently — a mistake here produces a page that
renders but never hydrates, or data belonging to the wrong tenant, not a crash.

Read `README.md` "Why this stack combination works" for the same material in
prose. This file is the operating manual.

## The five files

| File | Job |
|---|---|
| `src/entry-server.tsx` | `createHandler(fn, options, routerLoad)` — the seam itself, plus the `<QueryState />` script tag |
| `src/router.tsx` | `createRouter()` factory, `getQueryClient()`, `hydrateQueryState()`, `QUERY_STATE_ID` |
| `src/app.tsx` | `resolveRouter()` — per-request router on the server, module router in the browser |
| `src/entry-client.tsx` | rehydrates the query cache, then mounts `StartClientTanstack` |
| `vite.config.ts` | keeps the two filesystem routers apart (`routeDir: "./api"`) |

## Ordering — why loader data is in the first byte

`createHandler`'s **third** argument runs after middleware but before the page
event and before render (signature verified in
`node_modules/@solidjs/start/dist/server/handler.d.ts`):

```
1. middleware      src/middleware.ts populates event.locals (supabase, auth, activeOrgId, nonce)
2. routerLoad      src/entry-server.tsx matches the route and awaits router.load()
3. render          src/app.tsx reads the already-loaded router off event.locals
```

`routerLoad` creates a router, parks it on `event.locals.router`, calls
`router.update({ history: createMemoryHistory(...), context: router.options.context })`
and awaits `router.load()`. Re-passing the existing context is load-bearing:
`update` requires `context`, and passing a fresh object would throw away the
QueryClient the loaders are about to fill.

## Rules that must not be broken

**1. The server router is per-request. Never a module singleton.**
`createRouter()` in `src/router.tsx` is a factory. Its QueryClient holds one
request's loader data; sharing an instance would serve one user's rows to
another. `clientRouter` is a module-level instance *only* because
`isServer ? undefined : createRouter()`. `resolveRouter()` in `src/app.tsx`
throws rather than falling back when `event.locals.router` is missing — do not
"fix" that throw by substituting `clientRouter`.

**2. `StartClientTanstack`, not `StartClient`.** `src/entry-client.tsx` mounts
`StartClientTanstack` (both are exported from `@solidjs/start/client`). It wraps
one fewer element, so the client tree depth matches what the server rendered.
The wrong one yields hydration mismatches, which SolidStart reports as a console
warning and nothing else.

**3. Loader data crosses the wire through TanStack Query, not TanStack Router.**
Router's own SSR payload mechanism is not in play when SolidStart owns the
document. Out of the box every loader would re-run on hydration. The chain is:

- loaders call `context.queryClient.ensureQueryData(<something from src/lib/queries.ts>)`
- `<QueryState />` in `src/entry-server.tsx` inlines `dehydrate(...)` into
  `<script id="__QUERY_STATE__" type="application/json">` (`<` escaped so a value
  containing `</script>` cannot break out)
- `hydrateQueryState()` runs in `src/entry-client.tsx` **before** `mount`

A loader that fetches by any other route — a bare `fetch`, a `"use server"` call
outside a query, state stashed on a module — is invisible to `dehydrate` and will
re-fetch after hydration. Always go through a `queryOptions` factory in
`src/lib/queries.ts`, and have the component read the **same key** via `useQuery`;
a key that drifts from the loader's is a guaranteed refetch.

Also load-bearing: `staleTime: 60_000` in `createRouter()`'s default options.
Without it every transferred entry is stale on arrival and refetched
immediately, which defeats the transfer. `defaultPreloadStaleTime: 0` is
deliberate — Query owns freshness, the router must not add a second policy.

## Adding a page route

1. Create the file under `src/routes/`. Nesting is the URL:
   `src/routes/_authed/$orgSlug/projects/index.tsx` →
   `createFileRoute("/_authed/$orgSlug/projects/")`. `_authed` is a pathless
   layout (session gate, `src/routes/_authed.tsx`); `$orgSlug` is the tenant
   scope (`src/routes/_authed/$orgSlug.tsx`, which publishes `org` on context).
2. `tanstackRouter({ target: "solid" })` in `vite.config.ts` regenerates
   `src/routeTree.gen.ts` on save. That file is committed but never hand-edited.
3. Search params: `validateSearch` with a zod schema. Use `.catch(1)` style
   fallbacks so `?page=banana` degrades instead of throwing — see
   `src/routes/_authed/$orgSlug/issues.tsx`.
4. If the loader depends on search params, declare `loaderDeps` — that is what
   makes it re-run on a filter change, and only then.
5. Loader: `ensureQueryData` on a shared query, never a direct RPC call.
6. Guards go in `beforeLoad` and `throw redirect(...)` / `throw notFound()`, so
   the decision happens during SSR and no intermediate screen paints. See
   `src/routes/index.tsx`.
7. Route guards are UX, not security. Every `"use server"` function is a public
   HTTP endpoint; `authorize()` in the RPC layer and RLS are the real checks.
   The banner in `src/routes/_authed.tsx` says so at length.

## Adding an HTTP endpoint

`src/api/**` belongs to SolidStart's filesystem router; `src/routes/**` belongs
entirely to TanStack Router. They never see each other's files.

`routeDir: "./api"` makes `src/api` the route **root**, so there is no `/api`
prefix: `src/api/health.ts` is served at `/health`, `src/api/auth/callback.ts`
at `/auth/callback`. Requesting `/api/health` falls through to TanStack Router
and renders the not-found page with status 200 — a health check that reports
success forever. Export `GET`/`POST`/… taking an `APIEvent`.

The route manifest is watched in dev (`add`/`change`/`unlink` are wired to the
router in `node_modules/@solidjs/start/dist/config/fs-routes/fs-watcher.js`), so
a new file is normally picked up live. If a new endpoint 404s anyway, restart
the dev server before debugging anything else.

## The reactivity rule (this caused a real, shipped bug)

`Route.useRouteContext()`, `Route.useParams()` and `Route.useSearch()` return
**signals**.

```ts
// WRONG — snapshots at mount
const { org } = Route.useRouteContext()();

// RIGHT
const context = Route.useRouteContext();
const org = () => context().org;
const session = () => context().session;
```

Why it matters: a route component does **not** remount when only a param
changes. Ten files did the wrong thing, and switching organizations left the
whole shell pinned to the previous tenant — the switcher kept the old name, the
sidebar built `/old-slug/...` hrefs so every link showed the wrong org's data,
and the equality check in the switch handler compared against the stale id, so
you could not switch back. See the long comment at the top of `OrgLayout` in
`src/routes/_authed/$orgSlug.tsx` and the entry in `CHECKLIST.md`.

Two corollaries:

- **Inside `beforeLoad` the context is a plain object, not a signal.** Writing
  `context()` there fails at runtime. The ten-file fix deliberately left every
  `beforeLoad` alone.
- **`<Show when={session}>` with an *uncalled* accessor is always truthy.** A
  function is truthy; TypeScript cannot catch it, and the branch silently never
  flips. Caught in review on `src/routes/reset-password.tsx`, which would have
  rendered a password form with no session. Always `when={session()}`.

Passing `session()` down as a component prop is fine — Solid props are lazy
getters, so `<Can session={session()} …>` stays reactive (`src/components/Can.tsx`).

`e2e/org-switching.spec.ts` guards this. It asserts the switcher label, the
heading, every sidebar href and the member list, because a URL-only assertion
passes against the broken build.

## Two caches, not one

The router cache and the query cache are separate. After anything that changes
what `getSession()` would return — sign-in, sign-up, accepting an invite, a
password reset, creating an org, switching org, editing the profile:

```ts
queryClient.removeQueries({ queryKey: ["session"] });
await router.invalidate();
```

`removeQueries`, not `invalidateQueries`. Invalidation only marks an entry stale
and schedules a refetch for **active observers** — nothing observes the session,
because the root route reads it in `beforeLoad` via `ensureQueryData`
(`src/routes/__root.tsx`). An invalidated entry is handed back unchanged, the
guard still sees the old value, and the router bounces you straight back to
`/login`. The full note is in `src/routes/login.tsx`; the same pair appears in
`signup.tsx`, `new-org.tsx`, `accept-invite.tsx`, `reset-password.tsx`,
`_authed/account.tsx` and `_authed/$orgSlug.tsx`.

Sign-out is the exception: `src/components/SignOutButton.tsx` calls
`queryClient.clear()`, because *everything* cached was fetched as the previous
user.

## Known upstream workaround

`devOverlay: false` in `vite.config.ts`. SolidStart 2.0.2's dev toolbar imports
a named export from CJS-only `source-map-js`; under Vite 8 the resulting
`SyntaxError` aborts the client entry module graph. The page renders from SSR
and never hydrates, so forms silently do nothing and no error points at the
cause. Dev-only; builds are unaffected. If someone re-enables it, that symptom
comes back.

## Symptom → cause

| Symptom | Look at |
|---|---|
| Page renders, forms do nothing, no error | hydration aborted — check the console for a module-level `SyntaxError`; `devOverlay` |
| Console warns about mismatched hydration | `StartClient` instead of `StartClientTanstack`; markup that differs between server and client |
| Loader re-runs immediately on hydration | loader bypassed `ensureQueryData`, or the component's query key differs from the loader's |
| Sign-in succeeds then bounces to `/login` | `invalidateQueries` where `removeQueries({ queryKey: ["session"] })` is required |
| Switching org leaves stale name/links/data | a snapshotted `useRouteContext()()` |
| A `<Show>` branch never flips | uncalled accessor in `when` |
| New `/api/...` endpoint 404s | there is no `/api` prefix; `src/api/x.ts` serves `/x` |
| `"No per-request router on event.locals"` | `routerLoad` is no longer passed as `createHandler`'s third argument |

## What this template does not do

Server-side `<head>` management. `src/entry-server.tsx` ships a static
`<title>Dashboard</title>`, and `PageTitle` (`src/components/title.tsx`) refines
it client-side only — doing it properly would mean threading a head registry
through the router, which was judged not worth it for an app entirely behind a
login. `e2e/ssr.spec.ts` asserts that authenticated loader data is present in the raw
server response, that a fully-rendered `/acme` issues **no** `/_server` requests
at all, and that navigation produces no console warnings.
