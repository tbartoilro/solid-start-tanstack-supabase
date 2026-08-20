import { createRootRouteWithContext, Outlet } from "@tanstack/solid-router";
import { Suspense } from "solid-js";
import type { Session } from "~/lib/auth";
import { sessionQuery } from "~/lib/queries";
import type { RouterContext } from "~/router";

/**
 * Resolves the session once per navigation and publishes it on the router
 * context, so child routes can make redirect decisions synchronously in their
 * own `beforeLoad` instead of each fetching it again.
 *
 * Because this runs inside `routerLoad` during SSR, the session is known before
 * a single byte of HTML is produced — which is what removes the authenticated
 * "flash of logged-out UI" entirely.
 */
export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context }): Promise<{ session: Session | null }> => {
    const session = await context.queryClient.ensureQueryData(sessionQuery());
    return { session };
  },
  component: RootComponent,
  notFoundComponent: () => (
    <main class="centered">
      <h1>Not found</h1>
      <p>That page does not exist, or you do not have access to it.</p>
      <a href="/">Go home</a>
    </main>
  ),
});

function RootComponent() {
  return (
    <Suspense fallback={<div class="centered">Loading…</div>}>
      <Outlet />
    </Suspense>
  );
}
