"use server";

import { toCsv } from "@orgadmin/core";
import { bulkSchemaFor, runBulk } from "@orgadmin/server";
import { z } from "zod";
import { auditResource } from "~/resources/audit";
import { issuesResource } from "~/resources/issues";
import { membersResource } from "~/resources/members";
import { projectsResource } from "~/resources/projects";
import { authorize, orgScoped } from "../guard";
import { enforceRateLimit } from "../rate-limit";
import * as issues from "../services/issues";
import * as members from "../services/members";
import * as projects from "../services/projects";

/**
 * Bulk operations.
 *
 * Every one of these is a loop over the same single-row service function the
 * one-at-a-time UI already calls. That is the whole design, and it is deliberate:
 * a batch SQL statement would be faster and would silently skip every per-row
 * rule the services enforce — that an admin may not mint an owner, that nobody
 * edits their own role, that an organization must keep an owner. Those live in
 * `services/members.ts` and in a database trigger, and none of them are
 * expressible as a `WHERE id IN (…)`.
 *
 * So bulk is not a shortcut around authorization. It is the same authorization,
 * applied N times, reporting N outcomes.
 */

const statusEnum = z.enum(["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]);
const roleEnum = z.enum(["owner", "admin", "member", "viewer"]);

/**
 * Rate-limited per organization, like the existing export.
 *
 * A bulk call does up to 500 round trips, so an unthrottled one is a cheap way
 * to keep a tenant's database busy. The limit is generous enough that ordinary
 * use never meets it.
 */
function throttle(name: string, orgId: string): void {
  enforceRateLimit({ name, subject: orgId, limit: 30, windowMs: 60 * 60_000 });
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

const issueIds = bulkSchemaFor(issuesResource, orgScoped);

export async function bulkDeleteIssues(input: unknown) {
  const { input: data, ctx } = await authorize("issues.write", issueIds, input);
  throttle("bulk-issues", ctx.orgId);
  return runBulk(data.ids, (id) => issues.deleteIssue(ctx, id));
}

export async function bulkSetIssueStatus(input: unknown) {
  const schema = issueIds.extend({ status: statusEnum });
  const { input: data, ctx } = await authorize("issues.write", schema, input);
  throttle("bulk-issues", ctx.orgId);
  return runBulk(data.ids, (id) =>
    issues.updateIssue(ctx, { issueId: id, status: data.status }),
  );
}

export async function bulkAssignIssues(input: unknown) {
  // `issues.assign` rather than `issues.write`, matching the single-row
  // endpoint: reassignment is a separate permission, and folding it in here
  // would hand it to everyone who can edit.
  const schema = issueIds.extend({ assigneeId: z.guid().nullable() });
  const { input: data, ctx } = await authorize("issues.assign", schema, input);
  throttle("bulk-issues", ctx.orgId);
  return runBulk(data.ids, (id) =>
    issues.updateIssue(ctx, { issueId: id, assigneeId: data.assigneeId }),
  );
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

const projectIds = bulkSchemaFor(projectsResource, orgScoped);

export async function bulkDeleteProjects(input: unknown) {
  const { input: data, ctx } = await authorize("projects.delete", projectIds, input);
  throttle("bulk-projects", ctx.orgId);
  return runBulk(data.ids, (id) => projects.deleteProject(ctx, id));
}

export async function bulkArchiveProjects(input: unknown) {
  const schema = projectIds.extend({ archived: z.boolean() });
  const { input: data, ctx } = await authorize("projects.write", schema, input);
  throttle("bulk-projects", ctx.orgId);
  return runBulk(data.ids, (id) =>
    projects.updateProject(ctx, { projectId: id, archived: data.archived }),
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

const memberIds = bulkSchemaFor(membersResource, orgScoped);

/**
 * Removing several members is the case that proves the per-row design.
 *
 * A batch delete would remove the last owner and leave the organization
 * unadministrable, or remove the caller's own membership. Looping the service
 * function means each row meets `assertCanAssignRole`, the self-removal check
 * and the `protect_last_owner` trigger in turn — and the ones that are refused
 * come back as refusals while the rest still go through.
 */
export async function bulkRemoveMembers(input: unknown) {
  const { input: data, ctx } = await authorize("members.manage", memberIds, input);
  throttle("bulk-members", ctx.orgId);
  return runBulk(data.ids, (id) => members.removeMember(ctx, id));
}

export async function bulkChangeMemberRole(input: unknown) {
  const schema = memberIds.extend({ role: roleEnum });
  const { input: data, ctx } = await authorize("members.manage", schema, input);
  throttle("bulk-members", ctx.orgId);
  return runBulk(data.ids, (id) =>
    members.changeMemberRole(ctx, { membershipId: id, role: data.role }),
  );
}

// ---------------------------------------------------------------------------
// Audit log — read-only, so the only bulk action is taking a copy
// ---------------------------------------------------------------------------

const auditIds = bulkSchemaFor(auditResource, orgScoped);

/**
 * The selected audit entries as CSV text.
 *
 * Returns a string rather than a Response. The app already turns a payload into
 * a download client-side with a Blob and an anchor — see the organization
 * export in the settings screen — and matching that keeps one download path
 * instead of two. It also keeps this endpoint testable without a browser.
 *
 * Ids are numbers here, not uuids: `audit_log` is the one table keyed on a
 * bigserial. `bulkSchemaFor` reads that off the descriptor, so the validation
 * follows automatically rather than being remembered.
 *
 * Rate-limited like the organization export, which this resembles: it is the
 * expensive read on the tenant.
 */
export async function exportAuditEntries(input: unknown) {
  const { input: data, ctx } = await authorize("audit.read", auditIds, input);
  enforceRateLimit({ name: "audit-export", subject: ctx.orgId, limit: 10, windowMs: 60 * 60_000 });

  const { data: rows, error } = await ctx.db
    .from("audit_log")
    .select("id, action, target_type, target_id, metadata, created_at, profiles(full_name, email)")
    .eq("org_id", ctx.orgId)
    // Re-read by id under RLS rather than trusting the ids to be this tenant's.
    // Selection is client state and crosses pages, so it is not evidence of
    // anything; a foreign id simply matches nothing here.
    //
    // Numbers, not the validated strings: selection state is keyed by string
    // because that is what the DOM and the table's row-id map deal in, while
    // this column is a bigserial. The schema has already checked each one is
    // digits, so the conversion cannot produce NaN.
    .in("id", data.ids.map(Number))
    .order("created_at", { ascending: false });

  if (error) throw new Error(`exportAuditEntries: ${error.message}`);

  type Row = NonNullable<typeof rows>[number];
  const actorOf = (row: Row) =>
    row.profiles as unknown as { full_name: string | null; email: string } | null;

  return {
    filename: `${ctx.orgSlug}-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    csv: toCsv(rows ?? [], [
      { header: "when", value: (r: Row) => r.created_at },
      { header: "actor", value: (r: Row) => actorOf(r)?.full_name ?? actorOf(r)?.email ?? "system" },
      { header: "action", value: (r: Row) => r.action },
      { header: "target_type", value: (r: Row) => r.target_type },
      { header: "target_id", value: (r: Row) => r.target_id },
      { header: "metadata", value: (r: Row) => r.metadata },
    ]),
    count: rows?.length ?? 0,
  };
}
