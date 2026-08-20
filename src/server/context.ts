import { getRequestEvent } from "solid-js/web";
import type { AppPermission, AppRole, OrgClaim } from "~/lib/auth";
import { forbidden, notFound, unauthenticated } from "./errors";
import type { Db } from "./supabase";

/** What middleware established about the caller. */
export interface RequestAuth {
  userId: string;
  email: string;
  orgs: OrgClaim[];
}

/**
 * Everything a domain service needs to act on behalf of a user, passed
 * explicitly rather than reached for ambiently. Services take this as an
 * argument so they can be unit-tested with a fabricated context and no HTTP.
 */
export interface AuthContext {
  userId: string;
  email: string;
  orgs: OrgClaim[];
  db: Db;
  requestId: string;
}

export interface OrgContext extends AuthContext {
  orgId: string;
  orgSlug: string;
  /** From the JWT claim. Fine for rendering; not sufficient to authorize. */
  role: AppRole;
}

function currentEvent() {
  const event = getRequestEvent();
  if (!event) {
    throw new Error("No request event available — this code must run on the server.");
  }
  return event;
}

export function requireAuth(): AuthContext {
  const { locals } = currentEvent();
  if (!locals.auth) throw unauthenticated();

  return {
    ...locals.auth,
    db: locals.supabase,
    requestId: locals.requestId,
  };
}

/**
 * Narrows the request to a single tenant.
 *
 * Membership is read from the JWT claim, which is cheap and needs no query.
 * That is safe here because this only decides *scope*, never permission — and
 * because a stale claim naming an org the user has since left yields a context
 * whose every query RLS will refuse.
 *
 * A non-member gets 404 rather than 403 so that organization ids and slugs
 * cannot be enumerated by probing.
 */
export function requireOrg(orgIdOrSlug?: string): OrgContext {
  const ctx = requireAuth();
  const { locals } = currentEvent();

  const target = orgIdOrSlug ?? locals.activeOrgId;
  if (!target) throw notFound("No organization selected.");

  const org = ctx.orgs.find((o) => o.id === target || o.slug === target);
  if (!org) throw notFound();

  return { ...ctx, orgId: org.id, orgSlug: org.slug, role: org.role };
}

/**
 * The authoritative permission check.
 *
 * Deliberately asks the database rather than reading `ctx.role`, because the
 * role in the JWT was true when the token was issued and may not be true now.
 * Every mutation goes through this.
 */
export async function requirePermission(
  ctx: OrgContext,
  permission: AppPermission,
): Promise<void> {
  const { data, error } = await ctx.db.rpc("has_permission", {
    permission,
    org_id: ctx.orgId,
  });

  if (error) {
    throw new Error(`permission check failed for ${permission}: ${error.message}`);
  }
  if (data !== true) {
    // The caller is a member of this org, so acknowledging the org exists
    // leaks nothing — 403 is the honest answer here.
    throw forbidden(`You need the "${permission}" permission to do that.`);
  }
}
