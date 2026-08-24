import { createMiddleware } from "@solidjs/start/middleware";
import { getCookie } from "@solidjs/start/http";
import { getRequestEvent } from "solid-js/web";
import { z } from "zod";
import type { OrgClaim } from "~/lib/auth";
import { ACTIVE_ORG_COOKIE } from "~/server/cookies";
import { applySecurityHeaders } from "~/server/security-headers";
import { createRequestClient } from "~/server/supabase";

/**
 * The JWT is signed by Supabase, but it is still input. Parsing the claim
 * defensively means a malformed shape degrades to "no orgs" rather than
 * propagating `undefined` into authorization-adjacent code.
 *
 * `z.guid()` and not `z.uuid()`: Zod 4's `uuid()` enforces the RFC 9562
 * version and variant bits, while a Postgres `uuid` column happily stores any
 * 128-bit value. Validating version bits on database ids rejects perfectly
 * legitimate keys — including every fixture id in supabase/seed.sql — and,
 * because the failure lands in the `.catch()` below, does so *silently*: the
 * user simply appears to belong to no organizations.
 */
const orgsClaimSchema = z.array(
  z.object({
    id: z.guid(),
    slug: z.string(),
    role: z.enum(["owner", "admin", "member", "viewer"]),
  }),
);

function parseOrgsClaim(raw: unknown): OrgClaim[] {
  const parsed = orgsClaimSchema.safeParse(raw ?? []);
  if (parsed.success) return parsed.data;

  // Falling back to "no orgs" is the safe default, but it must never be quiet:
  // an unparseable claim looks exactly like a user with no memberships, which
  // is indistinguishable from a permissions bug from the outside.
  console.error("[middleware] could not parse `orgs` claim; treating as no memberships", {
    issues: z.flattenError(parsed.error),
  });
  return [];
}

/**
 * Runs before `routerLoad`, so everything it puts on `event.locals` is
 * available to every route loader and every server function on this request.
 *
 * Its job is strictly to establish *who is asking*. It makes no authorization
 * decisions — those belong to the server functions in `src/server/rpc`, which
 * enforce them per operation.
 *
 * Gotcha: the `event` a middleware receives is the h3 event, which has no
 * `locals`. SolidStart's request event is reached via `getRequestEvent()`.
 */
export default createMiddleware([
  async (_h3Event, next) => {
    const event = getRequestEvent();
    if (!event) return next();

    event.locals.requestId = crypto.randomUUID();
    event.locals.nonce = crypto.randomUUID().replaceAll("-", "");
    applySecurityHeaders(event, event.locals.nonce);

    const supabase = createRequestClient(event);
    event.locals.supabase = supabase;

    // `getClaims` verifies the token's signature and refreshes it when needed,
    // writing any rotated cookies through the `setAll` handler. `getSession()`
    // is NOT a substitute: it trusts whatever is in the cookie without
    // verifying it, which is exactly the wrong property on a server.
    const { data, error } = await supabase.auth.getClaims();
    const claims = error ? null : (data?.claims ?? null);

    if (!claims?.sub) {
      event.locals.auth = null;
      event.locals.activeOrgId = null;
      return next();
    }

    const orgs = parseOrgsClaim(claims.orgs);

    event.locals.auth = {
      userId: claims.sub,
      email: typeof claims.email === "string" ? claims.email : "",
      orgs,
    };

    // Resolve the tenant this request is acting within. The cookie is a
    // *preference*, never a grant: it is only honoured if the user actually
    // holds a membership. A stale claim can at worst select an org whose rows
    // RLS will then refuse to return.
    const requested = getCookie(ACTIVE_ORG_COOKIE);
    const valid = requested && orgs.some((o) => o.id === requested);
    event.locals.activeOrgId = valid ? requested : (orgs[0]?.id ?? null);

    return next();
  },
]);
