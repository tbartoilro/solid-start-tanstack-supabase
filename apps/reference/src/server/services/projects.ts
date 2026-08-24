import type { Database } from "~/lib/database.types";
import type { OrgContext } from "../context";
import { applyList, type ListInput } from "@orgadmin/server";
import { projectsResource } from "~/resources/projects";
import { conflict, notFound } from "../errors";

type ProjectUpdate = Database["public"]["Tables"]["projects"]["Update"];

/**
 * Project domain logic.
 *
 * Everything here takes an explicit `OrgContext` rather than reaching for the
 * ambient request. That is what makes these functions unit-testable without a
 * server, and it keeps the "who is asking" decision in exactly one place — the
 * RPC boundary — instead of scattered through the domain.
 *
 * Queries never filter by `org_id` defensively *instead* of relying on RLS;
 * they do it as well as RLS. The explicit filter keeps the query planner honest
 * and makes intent obvious; RLS is what makes it safe.
 */

export interface ProjectSummary {
  id: string;
  name: string;
  key: string;
  description: string | null;
  archivedAt: string | null;
  openIssues: number;
}

export interface ProjectDetail extends ProjectSummary {
  createdAt: string;
}

/** Just enough of a project to render it as an option in a picker. */
export interface ProjectOption {
  id: string;
  name: string;
  key: string;
}

export interface ProjectListResult {
  projects: ProjectSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export type ListProjectsInput = ListInput;

export interface CreateProjectInput {
  name: string;
  key: string;
  description?: string | null;
}

export interface UpdateProjectInput {
  projectId: string;
  name?: string;
  description?: string | null;
  archived?: boolean;
}

const OPEN_STATUSES = ["backlog", "todo", "in_progress", "in_review"] as const;

export async function listProjects(
  ctx: OrgContext,
  input: ListProjectsInput,
): Promise<ProjectListResult> {
  // `count` counts the top-level rows, so the embedded `issues(count)` and the
  // filter on it narrow each project's open-issue tally without touching the
  // number of projects reported.
  const { data, error, count } = await applyList(
    ctx.db
      .from("projects")
      .select(projectsResource.select, { count: "exact" })
      .eq("org_id", ctx.orgId)
      .in("issues.status", OPEN_STATUSES),
    projectsResource,
    input,
  );

  if (error) throw new Error(`listProjects: ${error.message}`);

  return {
    projects: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      key: row.key,
      description: row.description,
      archivedAt: row.archived_at,
      openIssues: (row.issues as unknown as Array<{ count: number }>)?.[0]?.count ?? 0,
    })),
    total: count ?? 0,
    page: input.page,
    pageSize: input.pageSize,
  };
}

/**
 * Every project, unpaginated, as just enough to label an option.
 *
 * This exists for the pickers — the issue create form and the project filter —
 * for the same reason `listAllMembers` does. Handing them a page silently makes
 * every project past `pageSize` unfilterable and, worse, impossible to file an
 * issue against: the option simply is not offered, which reads as the project
 * having vanished rather than as a limit.
 *
 * Bounded by how many projects an organization has, so there is nothing to page.
 * Deliberately does not carry `openIssues` — an option needs a name, and the
 * embedded count is the expensive half of `listProjects`.
 */
export async function listAllProjects(ctx: OrgContext): Promise<ProjectOption[]> {
  const { data, error } = await ctx.db
    .from("projects")
    .select("id, name, key")
    .eq("org_id", ctx.orgId)
    .order("name");

  if (error) throw new Error(`listAllProjects: ${error.message}`);

  return data ?? [];
}

export async function getProject(ctx: OrgContext, projectId: string): Promise<ProjectDetail> {
  const { data, error } = await ctx.db
    .from("projects")
    .select("id, name, key, description, archived_at, created_at, issues(count)")
    .eq("org_id", ctx.orgId)
    .eq("id", projectId)
    .in("issues.status", OPEN_STATUSES)
    .maybeSingle();

  if (error) throw new Error(`getProject: ${error.message}`);
  // A project in another tenant is indistinguishable from one that does not
  // exist, because RLS filtered it out before we ever saw it.
  if (!data) throw notFound("That project does not exist.");

  return {
    id: data.id,
    name: data.name,
    key: data.key,
    description: data.description,
    archivedAt: data.archived_at,
    createdAt: data.created_at,
    openIssues: (data.issues as unknown as Array<{ count: number }>)?.[0]?.count ?? 0,
  };
}

export async function createProject(
  ctx: OrgContext,
  input: CreateProjectInput,
): Promise<{ id: string }> {
  const { data, error } = await ctx.db
    .from("projects")
    .insert({
      org_id: ctx.orgId,
      name: input.name,
      key: input.key.toUpperCase(),
      description: input.description ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique_violation, which for this table means the key is taken
    // within this organization.
    if (error.code === "23505") {
      throw conflict(`Project key "${input.key.toUpperCase()}" is already used in this organization.`);
    }
    throw new Error(`createProject: ${error.message}`);
  }

  return { id: data.id };
}

export async function updateProject(ctx: OrgContext, input: UpdateProjectInput): Promise<void> {
  const patch: ProjectUpdate = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.archived !== undefined) patch.archived_at = input.archived ? new Date().toISOString() : null;

  if (Object.keys(patch).length === 0) return;

  const { data, error } = await ctx.db
    .from("projects")
    .update(patch)
    .eq("org_id", ctx.orgId)
    .eq("id", input.projectId)
    .select("id");

  if (error) throw new Error(`updateProject: ${error.message}`);
  // RLS turns an unauthorized update into zero matched rows rather than an
  // error, so an empty result is the signal that nothing was permitted.
  if (!data?.length) throw notFound("That project does not exist.");
}

export async function deleteProject(ctx: OrgContext, projectId: string): Promise<void> {
  const { data, error } = await ctx.db
    .from("projects")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", projectId)
    .select("id");

  if (error) throw new Error(`deleteProject: ${error.message}`);
  if (!data?.length) throw notFound("That project does not exist.");
}
