import { z } from "zod";
import type { AppPermission } from "~/lib/auth";
import {
  requireAuth,
  requireOrg,
  requirePermission,
  type AuthContext,
  type OrgContext,
} from "./context";
import { invalidInput } from "./errors";

/**
 * The trust boundary, expressed once.
 *
 * Every tenant-scoped RPC runs through this in a fixed order:
 *
 *   validate  ->  scope to a tenant  ->  authorize  ->  handle
 *
 * Validating first means the tenant is resolved from a value that has already
 * been type-checked. Authorizing before the handler means no domain code ever
 * runs for a caller who was not allowed to reach it.
 *
 * This exists because SolidStart's `"use server"` functions are plain HTTP
 * endpoints with no implicit protection. A route guard in `beforeLoad` stops a
 * user *navigating* somewhere; it does nothing about a POST issued straight at
 * the endpoint. This is the check that actually holds.
 */
export async function authorize<S extends z.ZodType<{ orgSlug: string }>>(
  permission: AppPermission,
  schema: S,
  raw: unknown,
): Promise<{ input: z.output<S>; ctx: OrgContext }> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw invalidInput("Check the submitted values.", z.flattenError(parsed.error));
  }

  const ctx = requireOrg(parsed.data.orgSlug);
  await requirePermission(ctx, permission);

  return { input: parsed.data, ctx };
}

/**
 * The same discipline for calls that are authenticated but not tenant-scoped.
 *
 * Creating an organization and accepting an invitation both happen *before* the
 * caller is a member of anything, so `authorize` cannot apply: there is no org
 * to scope to and no permission to check. What still applies is that the input
 * is validated before any handler sees it, and that an anonymous caller is
 * turned away here rather than deeper in.
 *
 * Anything tenant-scoped must use `authorize` instead — this deliberately
 * performs no permission check at all.
 */
export async function authenticated<S extends z.ZodType>(
  schema: S,
  raw: unknown,
): Promise<{ input: z.output<S>; ctx: AuthContext }> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw invalidInput("Check the submitted values.", z.flattenError(parsed.error));
  }

  return { input: parsed.data, ctx: requireAuth() };
}

/**
 * Validate and scope to a tenant, without asserting a permission.
 *
 * For the handful of operations whose rule is not "holds permission X" and so
 * cannot be expressed as a single `authorize` call — currently only changing an
 * issue's status, which the assignee may do without `issues.write`. The finer
 * rule then lives in the database function that can actually see the row.
 *
 * Membership is still required, so this is a narrowing of `authorize`, not an
 * escape from it. Reach for `authorize` unless the rule genuinely depends on
 * the row.
 */
export async function withinOrg<S extends z.ZodType<{ orgSlug: string }>>(
  schema: S,
  raw: unknown,
): Promise<{ input: z.output<S>; ctx: OrgContext }> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw invalidInput("Check the submitted values.", z.flattenError(parsed.error));
  }

  return { input: parsed.data, ctx: requireOrg(parsed.data.orgSlug) };
}

/** Shared shape: every tenant-scoped call names the tenant it acts on. */
export const orgScoped = z.object({
  orgSlug: z.string().min(1),
});

/**
 * Translates a PostgREST error into the application's error vocabulary.
 *
 * RLS rejections surface as 42501 (insufficient privilege) or simply as zero
 * affected rows. Both are reported as "not found" for tenant data, so a failed
 * write cannot be used to confirm that a row exists.
 */
export function isRlsDenial(error: { code?: string } | null): boolean {
  return error?.code === "42501";
}
