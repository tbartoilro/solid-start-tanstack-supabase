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
  // Anything a loader or component throws lands here rather than blanking the
  // page. The message is whatever the RPC boundary judged safe to send — see
  // src/server/on-error.ts — never a raw stack.
  errorComponent: (props) => (
    <main class="centered">
      <div class="card">
        <h1>Something went wrong</h1>
        <p class="error">{props.error.message}</p>
        <p>
          <a href="/">Return to the dashboard</a>
        </p>
      </div>
    </main>
  ),
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
