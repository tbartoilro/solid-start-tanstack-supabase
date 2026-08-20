import type { APIEvent } from "@solidjs/start/server";

/**
 * Proves the router split: this file lives under `src/api`, which is the only
 * directory SolidStart's filesystem router scans (`routeDir` in vite.config.ts).
 * TanStack Router never sees it.
 *
 * Reports liveness only. It deliberately exposes nothing about the caller's
 * session, so it stays safe to point a load balancer or uptime check at.
 */
export function GET(event: APIEvent) {
  return Response.json({
    status: "ok",
    requestId: event.locals.requestId,
    at: new Date().toISOString(),
  });
}
