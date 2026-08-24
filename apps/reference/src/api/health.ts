import type { APIEvent } from "@solidjs/start/server";
// Imported for its side effect: src/server/env.ts validates the server
// environment as it loads and throws on anything missing.
//
// This is what makes the endpoint a *readiness* check rather than a liveness
// one. Nitro loads route handlers lazily, so without a reference like this a
// container with no SUPABASE_SECRET_KEY boots happily, answers this endpoint
// 200, and only fails once a real request touches a module that needs it —
// long after a deployment health gate has gone green.
import "~/server/env";

/**
 * Proves the router split: this file lives under `src/api`, which is the only
 * directory SolidStart's filesystem router scans (`routeDir` in vite.config.ts).
 * TanStack Router never sees it.
 *
 * Reports readiness: it answers 200 only if the server environment validated,
 * so a deployment gated on this endpoint fails fast on missing configuration
 * instead of going green and then serving 500s.
 *
 * It deliberately exposes nothing about the caller's session or the
 * configuration itself, so it stays safe to point a load balancer at.
 */
export function GET(event: APIEvent) {
  return Response.json({
    status: "ok",
    requestId: event.locals.requestId,
    at: new Date().toISOString(),
  });
}
