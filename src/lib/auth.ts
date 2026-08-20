import type { Database } from "./database.types";

/**
 * Shared auth vocabulary. Client-safe: this module must stay free of any
 * server-only import so route components can use it.
 *
 * The role and permission unions are derived from the generated database types
 * rather than written out by hand, so adding a permission in a migration and
 * forgetting to update the frontend is a type error instead of a silent gap.
 */
export type AppRole = Database["public"]["Enums"]["app_role"];
export type AppPermission = Database["public"]["Enums"]["app_permission"];

/** Membership as it appears in the JWT `orgs` claim. */
export interface OrgClaim {
  id: string;
  slug: string;
  role: AppRole;
}

/** Membership as the UI needs it, resolved against the database. */
export interface SessionOrg extends OrgClaim {
  name: string;
  permissions: AppPermission[];
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface Session {
  user: SessionUser;
  orgs: SessionOrg[];
  activeOrgId: string | null;
}

/**
 * Whether the session's permissions include `permission` in `orgId`.
 *
 * This decides what to *render*. It never decides whether an operation is
 * allowed — that is settled server-side by `private.authorize()`, which reads
 * live data rather than a snapshot taken when the page loaded.
 */
export function can(
  session: Session | null | undefined,
  orgId: string | null | undefined,
  permission: AppPermission,
): boolean {
  if (!session || !orgId) return false;
  const org = session.orgs.find((o) => o.id === orgId);
  return org?.permissions.includes(permission) ?? false;
}

export function findOrgBySlug(session: Session | null | undefined, slug: string) {
  return session?.orgs.find((o) => o.slug === slug) ?? null;
}

export function activeOrg(session: Session | null | undefined): SessionOrg | null {
  if (!session?.activeOrgId) return null;
  return session.orgs.find((o) => o.id === session.activeOrgId) ?? null;
}
