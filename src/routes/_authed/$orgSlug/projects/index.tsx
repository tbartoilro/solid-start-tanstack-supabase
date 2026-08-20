import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { createSignal, For, Show } from "solid-js";
import { Can } from "~/components/Can";
import { projectsQuery } from "~/lib/queries";
import { createProject, deleteProject } from "~/server/rpc/projects";

export const Route = createFileRoute("/_authed/$orgSlug/projects/")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(projectsQuery(params.orgSlug)),
  component: ProjectsPage,
});

function ProjectsPage() {
  const params = Route.useParams();
  const { session, org } = Route.useRouteContext()();
  const queryClient = useQueryClient();

  const projects = useQuery(() => projectsQuery(params().orgSlug));

  const [name, setName] = createSignal("");
  const [key, setKey] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["projects", params().orgSlug] });
  }

  async function onCreate(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await createProject({ orgSlug: params().orgSlug, name: name(), key: key() });
      setName("");
      setKey("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the project.");
    } finally {
      setPending(false);
    }
  }

  async function onDelete(projectId: string) {
    setError(null);
    try {
      await deleteProject({ orgSlug: params().orgSlug, projectId });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the project.");
    }
  }

  return (
    <>
      <header class="page-header">
        <h1>Projects</h1>
      </header>

      <Show when={error()}>
        <p class="error" role="alert">
          {error()}
        </p>
      </Show>

      {/*
        The form is hidden without projects.write, and createProject() checks
        the same permission server-side. Both, always.
      */}
      <Can session={session} orgId={org.id} permission="projects.write">
        <form class="card inline-form" onSubmit={onCreate}>
          <label>
            Name
            <input value={name()} onInput={(e) => setName(e.currentTarget.value)} required />
          </label>
          <label>
            Key
            <input
              value={key()}
              onInput={(e) => setKey(e.currentTarget.value.toUpperCase())}
              placeholder="WEB"
              required
            />
          </label>
          <button type="submit" disabled={pending()}>
            Create project
          </button>
        </form>
      </Can>

      <section class="card">
        <table class="table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Name</th>
              <th>Open issues</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For each={projects.data}>
              {(p) => (
                <tr>
                  <td>
                    <span class="key">{p.key}</span>
                  </td>
                  <td>
                    <Link
                      to="/$orgSlug/projects/$projectId"
                      params={{ orgSlug: params().orgSlug, projectId: p.id }}
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td>{p.openIssues}</td>
                  <td class="row-actions">
                    <Can session={session} orgId={org.id} permission="projects.delete">
                      <button type="button" class="danger" onClick={() => onDelete(p.id)}>
                        Delete
                      </button>
                    </Can>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </section>
    </>
  );
}
