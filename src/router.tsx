import { hydrate, QueryClient } from "@tanstack/solid-query";
import { createRouter as createTanstackSolidRouter } from "@tanstack/solid-router";
import { isServer } from "solid-js/web";
import { routeTree } from "./routeTree.gen";

/** id of the <script> tag carrying the dehydrated query cache. */
export const QUERY_STATE_ID = "__QUERY_STATE__";

export interface RouterContext {
  queryClient: QueryClient;
}

/**
 * Factory, not a singleton.
 *
 * On the server a router (and its QueryClient) holds the loader data for
 * exactly one request. Sharing one instance across requests would leak one
 * user's data into another user's response, so `entry-server.tsx` calls this
 * per request and stores the result on `event.locals`.
 */
export function createRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // The cache arrives pre-populated from the server. Without a stale time
        // the client would consider every entry stale on arrival and refetch it
        // immediately, which defeats the whole point of transferring it.
        staleTime: 60_000,
        retry: 1,
      },
    },
  });

  return createTanstackSolidRouter({
    routeTree,
    context: { queryClient } satisfies RouterContext,
    defaultPreload: "intent",
    // TanStack Query owns freshness, so the router should not add a second,
    // competing staleness policy on top of the cache.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    defaultErrorComponent: (props) => (
      <pre style={{ padding: "1rem", color: "crimson" }}>
        {props.error.stack ?? String(props.error)}
      </pre>
    ),
  });
}

export type AppRouter = ReturnType<typeof createRouter>;

/** The QueryClient bound to a given router instance. */
export function getQueryClient(router: AppRouter): QueryClient {
  return router.options.context.queryClient;
}

/**
 * The browser only ever has one router, so a module-level instance is correct
 * there. It is deliberately never constructed on the server.
 */
export const clientRouter = isServer ? (undefined as unknown as AppRouter) : createRouter();

/**
 * Rehydrate the query cache from the payload the server inlined into the HTML,
 * so the client reuses server-fetched data instead of requesting it again.
 * Must run before the router mounts and its loaders execute.
 */
export function hydrateQueryState() {
  const el = document.getElementById(QUERY_STATE_ID);
  if (!el?.textContent) return;
  try {
    hydrate(getQueryClient(clientRouter), JSON.parse(el.textContent));
  } catch (err) {
    // A corrupt payload must not blank the page — the loaders will simply
    // refetch, which is slower but correct.
    console.error("[hydrate] failed to restore query cache", err);
  }
}

declare module "@tanstack/solid-router" {
  interface Register {
    router: AppRouter;
  }
}
