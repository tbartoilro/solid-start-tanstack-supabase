import { queryOptions } from "@tanstack/solid-query";
import { getSession } from "~/server/rpc/auth";
import { listIssues } from "~/server/rpc/issues";
import { listAllMembers, listInvitations, listMembers } from "~/server/rpc/members";
import { listAuditLog } from "~/server/rpc/org";
import { getProject, listAllProjects, listProjects } from "~/server/rpc/projects";

/**
 * Query definitions shared by route loaders and components.
 *
 * Importing a `"use server"` function from client-reachable code is safe and
 * intended: the compiler replaces the body with an RPC stub in the client
 * bundle, so only the call signature ships. During SSR the same import is a
 * direct in-process call with no network hop.
 *
 * Defining each query in one place means a loader and the component that reads
 * it cannot drift apart on the key, which is what would otherwise cause a
 * refetch on hydration.
 */

export const sessionQuery = () =>
  queryOptions({
    queryKey: ["session"] as const,
    queryFn: () => getSession(),
    // Identity changes rarely, and a stale copy only affects rendering.
    staleTime: 5 * 60_000,
  });

export const projectsQuery = (orgSlug: string, page: number) =>
  queryOptions({
    queryKey: ["projects", orgSlug, page] as const,
    queryFn: () => listProjects({ orgSlug, page }),
  });

/**
 * Every project in one go, for the pickers.
 *
 * Deliberately not `projectsQuery(slug, 1)`: a picker showing only the first
 * page cannot file an issue against project 26, and offers no clue why. Same
 * reasoning as [allMembersQuery] below.
 *
 * Keyed under the same `projects` prefix as the paged query, so the existing
 * prefix invalidation after a create or delete refreshes both.
 */
export const allProjectsQuery = (orgSlug: string) =>
  queryOptions({
    queryKey: ["projects", orgSlug, "all"] as const,
    queryFn: () => listAllProjects({ orgSlug }),
  });

export const projectQuery = (orgSlug: string, projectId: string) =>
  queryOptions({
    queryKey: ["project", orgSlug, projectId] as const,
    queryFn: () => getProject({ orgSlug, projectId }),
  });

export interface IssueFilters {
  projectId?: string;
  status?: Array<"backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled">;
  assigneeId?: string;
  search?: string;
  page: number;
}

export const issuesQuery = (orgSlug: string, filters: IssueFilters) =>
  queryOptions({
    // Filters are part of the key, so every distinct view of the table is
    // cached separately and going "back" to a previous filter is instant.
    queryKey: ["issues", orgSlug, filters] as const,
    queryFn: () => listIssues({ orgSlug, ...filters }),
  });

export const membersQuery = (orgSlug: string, page: number) =>
  queryOptions({
    queryKey: ["members", orgSlug, page] as const,
    queryFn: () => listMembers({ orgSlug, page }),
  });

/**
 * Every member in one go, for the assignee pickers.
 *
 * Deliberately not `membersQuery(slug, 1)`: a picker showing only the first
 * page would quietly drop everyone after it, and "why can I not assign this to
 * Sam" is a bug nobody reports as pagination.
 *
 * Keyed under the same `members` prefix as the paged query, so the existing
 * prefix invalidation on the members screen refreshes both.
 */
export const allMembersQuery = (orgSlug: string) =>
  queryOptions({
    queryKey: ["members", orgSlug, "all"] as const,
    queryFn: () => listAllMembers({ orgSlug }),
  });

export const invitationsQuery = (orgSlug: string) =>
  queryOptions({
    queryKey: ["invitations", orgSlug] as const,
    queryFn: () => listInvitations({ orgSlug }),
  });

export const auditQuery = (orgSlug: string, page: number) =>
  queryOptions({
    queryKey: ["audit", orgSlug, page] as const,
    queryFn: () => listAuditLog({ orgSlug, page }),
  });
