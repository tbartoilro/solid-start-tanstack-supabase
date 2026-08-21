import type { OrgContext } from "../context";

/**
 * Tenant-scoped data export.
 *
 * Exists so a GDPR access request has an answer that is not "an engineer runs a
 * query". Every read below goes through the request-scoped client, so RLS is
 * still the thing deciding what lands in the file — an export cannot become a
 * way to reach past the policies that constrain every other read.
 *
 * Returns plain objects rather than a file; serialisation belongs to the caller.
 */

export interface OrgExport {
  exportedAt: string;
  organization: unknown;
  members: unknown[];
  projects: unknown[];
  issues: unknown[];
  invitations: unknown[];
  auditLog: unknown[];
}

export async function exportOrg(ctx: OrgContext): Promise<OrgExport> {
  const [org, members, projects, issues, invitations, auditLog] = await Promise.all([
    ctx.db.from("organizations").select("*").eq("id", ctx.orgId).single(),
    ctx.db
      .from("memberships")
      .select("role, created_at, profiles(email, full_name)")
      .eq("org_id", ctx.orgId),
    ctx.db.from("projects").select("*").eq("org_id", ctx.orgId),
    ctx.db.from("issues").select("*").eq("org_id", ctx.orgId),
    ctx.db.from("invitations").select("email, role, created_at, accepted_at").eq("org_id", ctx.orgId),
    ctx.db.from("audit_log").select("*").eq("org_id", ctx.orgId),
  ]);

  const failed = [org, members, projects, issues, invitations, auditLog].find((r) => r.error);
  if (failed?.error) throw new Error(`exportOrg: ${failed.error.message}`);

  return {
    // Stamped server-side so the file records when it was produced, not when it
    // was downloaded.
    exportedAt: new Date().toISOString(),
    organization: org.data,
    members: members.data ?? [],
    projects: projects.data ?? [],
    issues: issues.data ?? [],
    // Tokens are deliberately excluded: an export is a record of who was
    // invited, not a bundle of live credentials.
    invitations: invitations.data ?? [],
    auditLog: auditLog.data ?? [],
  };
}
