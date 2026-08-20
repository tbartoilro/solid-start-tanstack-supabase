import { createMiddleware } from "@solidjs/start/middleware";
import { getRequestEvent } from "solid-js/web";

/**
 * Runs before `routerLoad`, so anything placed on `event.locals` here is
 * visible to every TanStack Router loader and every server function.
 *
 * Gotcha worth remembering: the `event` handed to a middleware is the *h3*
 * event, which has no `locals`. SolidStart's own request event — the one
 * carrying `locals` — is only reachable through `getRequestEvent()`, because
 * the middleware is wrapped in `provideRequestEvent` before it runs.
 *
 * Phase 2 populates this with the Supabase session and active organization.
 * For now it only tags the request so logging has something to correlate on.
 */
export default createMiddleware([
  async (_event, next) => {
    const requestEvent = getRequestEvent();
    if (requestEvent) {
      requestEvent.locals.requestId = crypto.randomUUID();
    }
    return next();
  },
]);
