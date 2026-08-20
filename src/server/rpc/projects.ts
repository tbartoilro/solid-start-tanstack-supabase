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

export async function listProjects(input: unknown) {
  const { ctx } = await authorize("projects.read", orgScoped, input);
  return projects.listProjects(ctx);
}

const getSchema = orgScoped.extend({ projectId: z.uuid() });

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
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullish(),
  archived: z.boolean().optional(),
});

export async function updateProject(input: unknown) {
  const { input: data, ctx } = await authorize("projects.write", updateSchema, input);
  await projects.updateProject(ctx, data);
  return { ok: true as const };
}

const deleteSchema = orgScoped.extend({ projectId: z.uuid() });

export async function deleteProject(input: unknown) {
  const { input: data, ctx } = await authorize("projects.delete", deleteSchema, input);
  await projects.deleteProject(ctx, data.projectId);
  return { ok: true as const };
}
