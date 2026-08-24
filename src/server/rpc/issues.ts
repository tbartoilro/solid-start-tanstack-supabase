"use server";

import { z } from "zod";
import { authorize, orgScoped, withinOrg } from "../guard";
import { forbidden, notFound } from "../errors";
import * as issues from "../services/issues";

const statusEnum = z.enum(["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]);
const priorityEnum = z.enum(["none", "low", "medium", "high", "urgent"]);

/**
 * Pagination is clamped server-side. A client asking for `pageSize=100000`
 * gets 100 — the endpoint is public, so limits cannot be enforced by the UI
 * that happens to call it.
 */
const listSchema = orgScoped.extend({
  projectId: z.guid().optional(),
  status: z.array(statusEnum).optional(),
  assigneeId: z.guid().optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25),
});

export async function listIssues(input: unknown) {
  const { input: data, ctx } = await authorize("issues.read", listSchema, input);
  return issues.listIssues(ctx, data);
}

const createSchema = orgScoped.extend({
  projectId: z.guid(),
  title: z.string().trim().min(1, "Give the issue a title.").max(200),
  description: z.string().trim().max(10_000).nullish(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  assigneeId: z.guid().nullish(),
});

export async function createIssue(input: unknown) {
  const { input: data, ctx } = await authorize("issues.write", createSchema, input);
  return issues.createIssue(ctx, data);
}

const updateSchema = orgScoped.extend({
  issueId: z.guid(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(10_000).nullish(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  assigneeId: z.guid().nullish(),
});

export async function updateIssue(input: unknown) {
  const { input: data, ctx } = await authorize("issues.write", updateSchema, input);
  await issues.updateIssue(ctx, data);
  return { ok: true as const };
}

/**
 * Reassignment is a separate permission from editing, so it gets a separate
 * endpoint rather than being folded into `updateIssue` — otherwise anyone with
 * `issues.write` would inherit `issues.assign` for free.
 */
const assignSchema = orgScoped.extend({
  issueId: z.guid(),
  assigneeId: z.guid().nullable(),
});

export async function assignIssue(input: unknown) {
  const { input: data, ctx } = await authorize("issues.assign", assignSchema, input);
  await issues.updateIssue(ctx, { issueId: data.issueId, assigneeId: data.assigneeId });
  return { ok: true as const };
}

const deleteSchema = orgScoped.extend({ issueId: z.guid() });

export async function deleteIssue(input: unknown) {
  const { input: data, ctx } = await authorize("issues.write", deleteSchema, input);
  await issues.deleteIssue(ctx, data.issueId);
  return { ok: true as const };
}

const setStatusSchema = orgScoped.extend({
  issueId: z.guid(),
  status: statusEnum,
});

/**
 * Status-only update, reachable by the assignee.
 *
 * Deliberately not behind `authorize("issues.write", ...)`. Being handed a task
 * has to carry the right to report on it, whatever role you otherwise hold — a
 * viewer assigned an issue can close it, and could not before.
 *
 * `withinOrg` establishes membership and nothing more; the actual rule needs to
 * see the row's assignee, so it lives in `public.set_issue_status`. That is also
 * why this is a database function rather than a widened RLS policy: "may change
 * the status" is not "may change the row", and an UPDATE policy cannot express
 * the difference.
 */
export async function setIssueStatus(input: unknown) {
  const { input: data, ctx } = await withinOrg(setStatusSchema, input);

  const { error } = await ctx.db.rpc("set_issue_status", {
    target_issue: data.issueId,
    next_status: data.status,
  });

  if (error) {
    // The function raises no_data_found for a non-member or unknown issue, and
    // insufficient_privilege when the caller is neither writer nor assignee.
    if (error.code === "P0002" || /not found/i.test(error.message)) {
      throw notFound("That issue does not exist.");
    }
    throw forbidden("You cannot change that issue's status.");
  }

  return { ok: true as const };
}
