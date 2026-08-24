"use server";

import { z } from "zod";
import { authorize, orgScoped } from "../guard";
import * as projects from "../services/projects";

/**
 * Project RPC.
 *
 * Each export is an HTTP endpoint. They are deliberately thin: validate and
 * authorize via `authorize()`, then hand off to the domain service. No business
 * logic lives here, and no authorization logic lives in the service.
 */

/**
 * Pagination is clamped server-side, because the endpoint is public and a
 * limit the UI happens to respect is not a limit. `.catch` rather than a hard
 * rejection: anything out of range (`pageSize=100000`, `page=0`, `page=abc`)
 * falls back to the default instead of erroring, so a mangled URL still
 * renders a page.
 */
const listSchema = orgScoped.extend({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25),
});

export async function listProjects(input: unknown) {
  const { input: data, ctx } = await authorize("projects.read", listSchema, input);
  return projects.listProjects(ctx, data);
}

/**
 * The unpaginated catalogue, for pickers that must offer every project.
 *
 * Separate endpoint rather than a `pageSize=all` escape hatch on the one above,
 * so the paged endpoint keeps a ceiling that cannot be argued away by input.
 * Same `projects.read` permission: it exposes nothing the paged call does not,
 * only in one response and without the open-issue counts.
 */
export async function listAllProjects(input: unknown) {
  const { ctx } = await authorize("projects.read", orgScoped, input);
  return projects.listAllProjects(ctx);
}

const getSchema = orgScoped.extend({ projectId: z.guid() });

export async function getProject(input: unknown) {
  const { input: data, ctx } = await authorize("projects.read", getSchema, input);
  return projects.getProject(ctx, data.projectId);
}

const createSchema = orgScoped.extend({
  name: z.string().trim().min(1, "Give the project a name.").max(120),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, "2–10 characters, letters and digits, starting with a letter."),
  description: z.string().trim().max(2000).nullish(),
});

export async function createProject(input: unknown) {
  const { input: data, ctx } = await authorize("projects.write", createSchema, input);
  return projects.createProject(ctx, data);
}

const updateSchema = orgScoped.extend({
  projectId: z.guid(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullish(),
  archived: z.boolean().optional(),
});

export async function updateProject(input: unknown) {
  const { input: data, ctx } = await authorize("projects.write", updateSchema, input);
  await projects.updateProject(ctx, data);
  return { ok: true as const };
}

const deleteSchema = orgScoped.extend({ projectId: z.guid() });

export async function deleteProject(input: unknown) {
  const { input: data, ctx } = await authorize("projects.delete", deleteSchema, input);
  await projects.deleteProject(ctx, data.projectId);
  return { ok: true as const };
}
