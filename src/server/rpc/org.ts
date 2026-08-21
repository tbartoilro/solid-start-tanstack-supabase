"use server";

import { z } from "zod";
import { authenticated, authorize, orgScoped } from "../guard";
import { notFound } from "../errors";
import { enforceRateLimit } from "../rate-limit";
import { refreshClaims } from "../refresh-claims";
import * as exportService from "../services/export";
import * as orgs from "../services/orgs";

/** Organization creation, settings and the audit trail. */

const createSchema = z.object({
  name: z.string().trim().min(1, "The organization needs a name.").max(100),
  /** Optional: derived from the name when omitted. */
  slug: z.string().trim().max(48).optional(),
});

/**
 * Creating an organization needs no permission — any signed-in user may start
 * one, and the `organizations_add_owner` trigger makes them its owner. It is
 * rate-limited for the same reason invites are: an unthrottled create loop is
 * a cheap way to fill the tenant table.
 */
export async function createOrganization(input: unknown) {
  const { input: data, ctx } = await authenticated(createSchema, input);

  enforceRateLimit({ name: "create-org", subject: ctx.userId, limit: 5, windowMs: 60 * 60_000 });

  const org = await orgs.createOrg(ctx, data);

  // The caller is now an owner, but their token does not say so yet.
  await refreshClaims();

  return org;
}

const updateSchema = orgScoped.extend({
  name: z.string().trim().min(1, "The organization needs a name.").max(100),
});

export async function updateOrgSettings(input: unknown) {
  const { input: data, ctx } = await authorize("org.settings", updateSchema, input);

  const { data: rows, error } = await ctx.db
    .from("organizations")
    .update({ name: data.name })
    .eq("id", ctx.orgId)
    .select("id");

  if (error) throw new Error(`updateOrgSettings: ${error.message}`);
  if (!rows?.length) throw notFound();

  return { ok: true as const };
}

const auditSchema = orgScoped.extend({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(50),
});

export async function listAuditLog(input: unknown) {
  const { input: data, ctx } = await authorize("audit.read", auditSchema, input);

  const from = (data.page - 1) * data.pageSize;

  const { data: rows, error, count } = await ctx.db
    .from("audit_log")
    .select("id, action, target_type, target_id, metadata, created_at, profiles(full_name, email)", {
      count: "exact",
    })
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .range(from, from + data.pageSize - 1);

  if (error) throw new Error(`listAuditLog: ${error.message}`);

  return {
    entries: (rows ?? []).map((row) => {
      const actor = row.profiles as unknown as { full_name: string | null; email: string } | null;
      return {
        id: row.id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        metadata: row.metadata,
        createdAt: row.created_at,
        actor: actor ? { fullName: actor.full_name, email: actor.email } : null,
      };
    }),
    total: count ?? 0,
    page: data.page,
    pageSize: data.pageSize,
  };
}

/**
 * Complete export of one tenant's data.
 *
 * Owner-only via the org.export permission. Rate-limited because it is by far
 * the heaviest read in the application and trivially loopable.
 */
export async function exportOrganization(input: unknown) {
  const { ctx } = await authorize("org.export", orgScoped, input);

  enforceRateLimit({ name: "org-export", subject: ctx.orgId, limit: 3, windowMs: 60 * 60_000 });

  return exportService.exportOrg(ctx);
}
