"use server";

import { z } from "zod";
import { authorize, orgScoped } from "../guard";
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
