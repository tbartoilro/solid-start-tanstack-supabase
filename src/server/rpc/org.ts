"use server";

import { z } from "zod";
import { authorize, orgScoped } from "../guard";
import { notFound } from "../errors";

/** Organization settings and the audit trail. */

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
