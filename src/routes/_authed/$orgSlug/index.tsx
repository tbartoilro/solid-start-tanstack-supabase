import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { issuesQuery, projectsQuery } from "~/lib/queries";

export const Route = createFileRoute("/_authed/$orgSlug/")({
  // Both datasets are prefetched during SSR, so the overview arrives fully
  // rendered rather than as a page full of spinners.
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(projectsQuery(params.orgSlug)),
      context.queryClient.ensureQueryData(issuesQuery(params.orgSlug, { page: 1 })),
    ]);
  },
  component: Overview,
});

function Overview() {
  const params = Route.useParams();
  const { org } = Route.useRouteContext()();

  const projects = useQuery(() => projectsQuery(params().orgSlug));
  const issues = useQuery(() => issuesQuery(params().orgSlug, { page: 1 }));

  const openCount = () =>
    (projects.data ?? []).reduce((sum, p) => sum + p.openIssues, 0);

  return (
    <>
      <header class="page-header">
        <h1>{org.name}</h1>
        <p class="muted">
          You are signed in as <strong>{org.role}</strong>.
        </p>
      </header>

      <section class="stat-row">
        <div class="stat">
          <div class="stat-value">{projects.data?.length ?? 0}</div>
          <div class="stat-label">Projects</div>
        </div>
        <div class="stat">
          <div class="stat-value">{openCount()}</div>
          <div class="stat-label">Open issues</div>
        </div>
        <div class="stat">
          <div class="stat-value">{issues.data?.total ?? 0}</div>
          <div class="stat-label">Total issues</div>
        </div>
      </section>

      <section class="card">
        <h2>Projects</h2>
        <Show
          when={(projects.data?.length ?? 0) > 0}
          fallback={<p class="muted">No projects yet.</p>}
        >
          <ul class="list">
            <For each={projects.data}>
              {(p) => (
                <li>
                  <Link
                    to="/$orgSlug/projects/$projectId"
                    params={{ orgSlug: params().orgSlug, projectId: p.id }}
                  >
                    <span class="key">{p.key}</span> {p.name}
                  </Link>
                  <span class="muted">{p.openIssues} open</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section class="card">
        <h2>Recently updated issues</h2>
        <ul class="list">
          <For each={issues.data?.issues.slice(0, 5)}>
            {(issue) => (
              <li>
                <span>
                  <span class="key">
                    {issue.project?.key}-{issue.number}
                  </span>{" "}
                  {issue.title}
                </span>
                <span class={`status status-${issue.status}`}>{issue.status}</span>
              </li>
            )}
          </For>
        </ul>
      </section>
    </>
  );
}
