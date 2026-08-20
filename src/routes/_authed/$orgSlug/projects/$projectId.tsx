import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { createSignal, For, Show } from "solid-js";
import { Can } from "~/components/Can";
import { issuesQuery, projectQuery } from "~/lib/queries";
import { createIssue } from "~/server/rpc/issues";

export const Route = createFileRoute("/_authed/$orgSlug/projects/$projectId")({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(projectQuery(params.orgSlug, params.projectId)),
      context.queryClient.ensureQueryData(
        issuesQuery(params.orgSlug, { projectId: params.projectId, page: 1 }),
      ),
    ]);
  },
  component: ProjectDetail,
});

function ProjectDetail() {
  const params = Route.useParams();
  const { session, org } = Route.useRouteContext()();
  const queryClient = useQueryClient();

  const project = useQuery(() => projectQuery(params().orgSlug, params().projectId));
  const issues = useQuery(() =>
    issuesQuery(params().orgSlug, { projectId: params().projectId, page: 1 }),
  );

  const [title, setTitle] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  async function onCreate(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createIssue({
        orgSlug: params().orgSlug,
        projectId: params().projectId,
        title: title(),
      });
      setTitle("");
      await queryClient.invalidateQueries({ queryKey: ["issues", params().orgSlug] });
      await queryClient.invalidateQueries({ queryKey: ["project", params().orgSlug] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the issue.");
    }
  }

  return (
    <>
      <header class="page-header">
        <h1>
          <span class="key">{project.data?.key}</span> {project.data?.name}
        </h1>
        <p class="muted">{project.data?.description ?? "No description."}</p>
      </header>

      <Show when={error()}>
        <p class="error" role="alert">
          {error()}
        </p>
      </Show>

      <Can session={session} orgId={org.id} permission="issues.write">
        <form class="card inline-form" onSubmit={onCreate}>
          <label>
            New issue
            <input
              value={title()}
              onInput={(e) => setTitle(e.currentTarget.value)}
              placeholder="What needs doing?"
              required
            />
          </label>
          <button type="submit">Create issue</button>
        </form>
      </Can>

      <section class="card">
        <table class="table">
          <thead>
            <tr>
              <th>Issue</th>
              <th>Title</th>
              <th>Status</th>
              <th>Assignee</th>
            </tr>
          </thead>
          <tbody>
            <For each={issues.data?.issues}>
              {(issue) => (
                <tr>
                  <td>
                    <span class="key">
                      {project.data?.key}-{issue.number}
                    </span>
                  </td>
                  <td>{issue.title}</td>
                  <td>
                    <span class={`status status-${issue.status}`}>{issue.status}</span>
                  </td>
                  <td>{issue.assignee?.fullName ?? issue.assignee?.email ?? "—"}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </section>
    </>
  );
}
