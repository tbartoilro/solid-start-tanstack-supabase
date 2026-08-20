import { createRootRouteWithContext, Link, Outlet } from "@tanstack/solid-router";
import { Suspense } from "solid-js";
import type { RouterContext } from "~/router";

/**
 * `createRootRouteWithContext` is what threads the router context type through
 * the whole generated route tree, so `loader: ({ context }) => ...` knows about
 * `queryClient` instead of seeing `{}`.
 */
export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <nav>
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
      </nav>
      <Suspense>
        <Outlet />
      </Suspense>
    </>
  );
}
