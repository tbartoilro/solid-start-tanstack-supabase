import type { Database } from "~/lib/database.types";
import type { OrgContext } from "../context";
import { notFound } from "../errors";

type IssueStatus = Database["public"]["Enums"]["issue_status"];
type IssuePriority = Database["public"]["Enums"]["issue_priority"];
type IssueInsert = Database["public"]["Tables"]["issues"]["Insert"];
type IssueUpdate = Database["public"]["Tables"]["issues"]["Update"];

export interface IssueRow {
  id: string;
  number: number;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  updatedAt: string;
  project: { id: string; key: string; name: string } | null;
  assignee: { id: string; fullName: string | null; email: string } | null;
}

export interface IssueListResult {
  issues: IssueRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListIssuesInput {
  projectId?: string;
  status?: IssueStatus[];
  assigneeId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export interface CreateIssueInput {
  projectId: string;
  title: string;
  description?: string | null;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigneeId?: string | null;
}

export interface UpdateIssueInput {
  issueId: string;
  title?: string;
  description?: string | null;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigneeId?: string | null;
}

const SELECT =
  "id, number, title, status, priority, updated_at, projects(id, key, name), profiles!issues_assignee_id_fkey(id, full_name, email)";

function toIssueRow(row: Record<string, unknown>): IssueRow {
  const project = row.projects as { id: string; key: string; name: string } | null;
  const assignee = row.profiles as { id: string; full_name: string | null; email: string } | null;

  return {
    id: row.id as string,
    number: row.number as number,
    title: row.title as string,
    status: row.status as IssueStatus,
    priority: row.priority as IssuePriority,
    updatedAt: row.updated_at as string,
    project: project ? { id: project.id, key: project.key, name: project.name } : null,
    assignee: assignee
      ? { id: assignee.id, fullName: assignee.full_name, email: assignee.email }
      : null,
  };
}

export async function listIssues(
  ctx: OrgContext,
  input: ListIssuesInput,
): Promise<IssueListResult> {
  const from = (input.page - 1) * input.pageSize;
  const to = from + input.pageSize - 1;

  let query = ctx.db
    .from("issues")
    .select(SELECT, { count: "exact" })
    .eq("org_id", ctx.orgId);

  if (input.projectId) query = query.eq("project_id", input.projectId);
  if (input.status?.length) query = query.in("status", input.status);
  if (input.assigneeId) query = query.eq("assignee_id", input.assigneeId);
  if (input.search) {
    // `ilike` on a user-supplied string: the Supabase client parameterises the
    // value, but `%` and `_` are wildcards, so they are escaped to keep the
    // search literal rather than letting a query scan everything.
    const escaped = input.search.replace(/[%_\\]/g, (m) => `\\${m}`);
    query = query.ilike("title", `%${escaped}%`);
  }

  const { data, error, count } = await query
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(`listIssues: ${error.message}`);

  return {
    issues: (data ?? []).map((row) => toIssueRow(row as unknown as Record<string, unknown>)),
    total: count ?? 0,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function createIssue(
  ctx: OrgContext,
  input: CreateIssueInput,
): Promise<{ id: string; number: number }> {
  // The project must belong to this tenant. RLS would refuse the insert anyway,
  // but checking first turns a confusing constraint error into a clear 404.
  const { data: project, error: projectError } = await ctx.db
    .from("projects")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("id", input.projectId)
    .maybeSingle();

  if (projectError) throw new Error(`createIssue/project: ${projectError.message}`);
  if (!project) throw notFound("That project does not exist.");

  // `number` is intentionally omitted: the issues_assign_number trigger fills
  // it in under an advisory lock so concurrent inserts cannot collide. The
  // generated types cannot express "supplied by a trigger", so the column reads
  // as required and the omission has to be asserted here.
  const payload: Omit<IssueInsert, "number"> = {
    org_id: ctx.orgId,
    project_id: input.projectId,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? "backlog",
    priority: input.priority ?? "none",
    assignee_id: input.assigneeId ?? null,
    created_by: ctx.userId,
  };

  const { data, error } = await ctx.db
    .from("issues")
    .insert(payload as IssueInsert)
    .select("id, number")
    .single();

  if (error) throw new Error(`createIssue: ${error.message}`);
  return { id: data.id, number: data.number };
}

export async function updateIssue(ctx: OrgContext, input: UpdateIssueInput): Promise<void> {
  const patch: IssueUpdate = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.status !== undefined) patch.status = input.status;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.assigneeId !== undefined) patch.assignee_id = input.assigneeId;

  if (Object.keys(patch).length === 0) return;

  const { data, error } = await ctx.db
    .from("issues")
    .update(patch)
    .eq("org_id", ctx.orgId)
    .eq("id", input.issueId)
    .select("id");

  if (error) throw new Error(`updateIssue: ${error.message}`);
  if (!data?.length) throw notFound("That issue does not exist.");
}

export async function deleteIssue(ctx: OrgContext, issueId: string): Promise<void> {
  const { data, error } = await ctx.db
    .from("issues")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", issueId)
    .select("id");

  if (error) throw new Error(`deleteIssue: ${error.message}`);
  if (!data?.length) throw notFound("That issue does not exist.");
}
