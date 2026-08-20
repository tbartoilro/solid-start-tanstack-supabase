import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { z } from "zod";
import { issuesQuery, projectsQuery, type IssueFilters } from "~/lib/queries";

const STATUSES = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"] as const;

/**
 * Filter state lives in the URL rather than component state, so a filtered view
 * is linkable, survives reload, and works with browser history.
 *
 * The schema is the contract. `.catch()` means a hand-edited `?page=banana`
 * degrades to page 1 instead of throwing, while genuinely unknown values are
 * dropped — the component never sees an unvalidated string.
 */
const searchSchema = z.object({
  project: z.guid().optional(),
  status: z.array(z.enum(STATUSES)).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).catch(1),
});

export const Route = createFileRoute("/_authed/$orgSlug/issues")({
  validateSearch: searchSchema,
  // Declaring the search params as loader deps is what makes the loader re-run
  // when a filter changes — and only then.
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps }) => {
    const filters: IssueFilters = {
      projectId: deps.project,
      status: deps.status,
      search: deps.q,
      page: deps.page,
    };
    await Promise.all([
      context.queryClient.ensureQueryData(issuesQuery(params.orgSlug, filters)),
      context.queryClient.ensureQueryData(projectsQuery(params.orgSlug)),
    ]);
  },
  component: IssuesPage,
});

function IssuesPage() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const filters = (): IssueFilters => ({
    projectId: search().project,
    status: search().status,
    search: search().q,
    page: search().page,
  });

  const issues = useQuery(() => issuesQuery(params().orgSlug, filters()));
  const projects = useQuery(() => projectsQuery(params().orgSlug));

  // Any filter change resets to page 1 — otherwise narrowing the results while
  // on page 7 lands the user on an empty screen.
  const setFilter = (patch: Record<string, unknown>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }) });

  const totalPages = () =>
    Math.max(1, Math.ceil((issues.data?.total ?? 0) / (issues.data?.pageSize ?? 25)));

  return (
    <>
      <header class="page-header">
        <h1>Issues</h1>
      </header>

      <section class="card filters">
        <label>
          Search
          <input
            type="search"
            value={search().q ?? ""}
            placeholder="Title contains…"
            onInput={(e) => setFilter({ q: e.currentTarget.value || undefined })}
          />
        </label>

        <label>
          Project
          <select
            value={search().project ?? ""}
            onChange={(e) => setFilter({ project: e.currentTarget.value || undefined })}
          >
            <option value="">All projects</option>
            <For each={projects.data}>{(p) => <option value={p.id}>{p.name}</option>}</For>
          </select>
        </label>

        <fieldset class="status-filter">
          <legend>Status</legend>
          <For each={STATUSES}>
            {(s) => (
              <label class="checkbox">
                <input
                  type="checkbox"
                  checked={search().status?.includes(s) ?? false}
                  onChange={(e) => {
                    const current = search().status ?? [];
                    const next = e.currentTarget.checked
                      ? [...current, s]
                      : current.filter((x) => x !== s);
                    setFilter({ status: next.length ? next : undefined });
                  }}
                />
                {s}
              </label>
            )}
          </For>
        </fieldset>
      </section>

      <section class="card">
        <table class="table">
          <thead>
            <tr>
              <th>Issue</th>
              <th>Title</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Assignee</th>
            </tr>
          </thead>
          <tbody>
            <For each={issues.data?.issues}>
              {(issue) => (
                <tr>
                  <td>
                    <span class="key">
                      {issue.project?.key}-{issue.number}
                    </span>
                  </td>
                  <td>{issue.title}</td>
                  <td>
                    <span class={`status status-${issue.status}`}>{issue.status}</span>
                  </td>
                  <td>{issue.priority}</td>
                  <td>{issue.assignee?.fullName ?? issue.assignee?.email ?? "—"}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>

        <Show when={(issues.data?.issues.length ?? 0) === 0}>
          <p class="muted">No issues match these filters.</p>
        </Show>

        <div class="pagination">
          <button
            type="button"
            disabled={search().page <= 1}
            onClick={() => navigate({ search: (p) => ({ ...p, page: p.page - 1 }) })}
          >
            Previous
          </button>
          <span class="muted">
            Page {search().page} of {totalPages()} · {issues.data?.total ?? 0} issues
          </span>
          <button
            type="button"
            disabled={search().page >= totalPages()}
            onClick={() => navigate({ search: (p) => ({ ...p, page: p.page + 1 }) })}
          >
            Next
          </button>
        </div>
      </section>
    </>
  );
}
