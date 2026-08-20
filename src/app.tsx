import { QueryClientProvider } from "@tanstack/solid-query";
import { RouterProvider } from "@tanstack/solid-router";
import { getRequestEvent, isServer } from "solid-js/web";
import { clientRouter, getQueryClient, type AppRouter } from "./router";

import "./app.css";

function resolveRouter(): AppRouter {
  if (!isServer) return clientRouter;

  // Must be the per-request instance created in `entry-server.tsx`, which has
  // already matched the route and run its loaders. Falling back to a shared
  // instance here would serve one request's data to another, so this is a hard
  // failure rather than a silent fallback.
  const router = getRequestEvent()?.locals.router;
  if (!router) {
    throw new Error(
      "No per-request router on event.locals — is `routerLoad` wired into createHandler?",
    );
  }
  return router;
}

export default function App() {
  const router = resolveRouter();

  return (
    <QueryClientProvider client={getQueryClient(router)}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
