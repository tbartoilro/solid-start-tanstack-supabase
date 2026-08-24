import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/solid-router";
import { createSignal, For, Show } from "solid-js";
import { Stack } from "styled-system/jsx";
import { z } from "zod";
import { Can } from "~/components/Can";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { CreateBar, Pagination, ResponsiveTable } from "~/components/data";
import { EmptyState, ErrorBanner, PageHeader } from "~/components/page";
import { IssueKey } from "~/components/StatusBadge";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import * as Table from "~/components/ui/table";
import { Text } from "~/components/ui/text";
import { projectsQuery } from "~/lib/queries";
import { projectsResource, PROJECT_SORTS, type ProjectSort } from "~/resources/projects";
import { SortableHeader } from "~/components/SortableHeader";
import { createProject, deleteProject } from "~/server/rpc/projects";
import { ISSUE_DEFAULT_SEARCH } from "~/resources/issues";

/*
 * The page lives in the URL, so a position in the list is linkable and survives
 * a reload. `.catch(1)` means a hand-edited `?page=banana` degrades to the first
 * page instead of throwing.
 */
const searchSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  // Generated from the descriptor, so a value the server would refuse cannot be
  // written here without a type error.
  sort: z.enum(PROJECT_SORTS).catch(projectsResource.defaultSort.column as ProjectSort),
  dir: z.enum(["asc", "desc"]).catch(projectsResource.defaultSort.dir),
});

export const Route = createFileRoute("/_authed/$orgSlug/projects/")({
  validateSearch: searchSchema,
  // Declaring the page as a loader dep is what makes the loader re-run when it
  // changes — and only then.
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(projectsQuery(params.orgSlug, deps)),
  component: ProjectsPage,
});

function ProjectsPage() {
  const params = Route.useParams();
  /*
   * Accessors, not destructured values. `useRouteContext()` returns a signal,
   * and this route does not remount when only `$orgSlug` changes — reading it
   * once at setup would leave the permission gates below judging the previous
   * organization after a switch.
   */
  const context = Route.useRouteContext();
  const session = () => context().session;
  const org = () => context().org;
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();

  const projects = useQuery(() => projectsQuery(params().orgSlug, search()));

  /*
   * A new sort returns to page 1. Staying on page 2 of a re-ordered list shows
   * rows with no relationship to what was just on screen, which reads as data
   * loss rather than a re-sort.
   */
  const setSort = (next: { column: string; dir: "asc" | "desc" }) =>
    void navigate({ search: { page: 1, sort: next.column as ProjectSort, dir: next.dir } });

  const totalPages = () =>
    Math.max(1, Math.ceil((projects.data?.total ?? 0) / (projects.data?.pageSize ?? 25)));

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
      <PageHeader title="Projects" description="Every project in this organization." />

      <ErrorBanner message={error()} />

      {/*
        The form is hidden without projects.write, and createProject() checks
        the same permission server-side. Both, always.
      */}
      <Can session={session()} orgId={org().id} permission="projects.write">
        <Card.Root mb="6">
          {/*
            `pt` because Park UI's card body zeroes its top padding — it
            assumes a Card.Header above supplies that side. These filter and
            create cards have no header, so without this the first control
            sits flush against the top border while the other three sides
            keep their 24px.
          */}
          <Card.Body pt="6">
            <form onSubmit={onCreate}>
              <CreateBar
                action={
                  <Button
                    type="submit"
                    size="sm"
                    loading={pending()}
                    width={{ base: "full", md: "auto" }}
                  >
                    Create project
                  </Button>
                }
              >
                <Field.Root required>
                  <Field.Label>Project name</Field.Label>
                  <Input
                    size="sm"
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                    placeholder="Web Platform"
                    required
                  />
                </Field.Root>
                {/*
                  A key is three or four characters, but it no longer carries a
                  fixed width: pinning it to 8rem was what left a ragged gap
                  beside the name field. It shares the grid column instead.
                */}
                <Field.Root required>
                  <Field.Label>Key</Field.Label>
                  <Input
                    size="sm"
                    value={key()}
                    onInput={(e) => setKey(e.currentTarget.value.toUpperCase())}
                    placeholder="WEB"
                    required
                  />
                </Field.Root>
              </CreateBar>
            </form>
          </Card.Body>
        </Card.Root>
      </Can>

      <Card.Root>
        <Card.Body p="0">
          <Show
            when={(projects.data?.projects.length ?? 0) > 0}
            fallback={
              <EmptyState
                title="No projects yet"
                description="Projects group issues. Create the first one above."
              />
            }
          >
            {/* Four columns do not survive a 390px viewport; scroll rather than wrap. */}
            <ResponsiveTable>
              <Table.Root size="sm">
                <Table.Head>
                  <Table.Row>
                    <For each={projectsResource.columns}>
                      {(column) => (
                        <SortableHeader
                          column={column}
                          sort={() => search().sort}
                          dir={() => search().dir}
                          onSort={setSort}
                        />
                      )}
                    </For>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  <For each={projects.data?.projects}>
                    {(p) => (
                      <Table.Row>
                        <Table.Cell data-label="Key">
                          <IssueKey>{p.key}</IssueKey>
                        </Table.Cell>
                        <Table.Cell data-primary>
                          {/*
                            `truncate` alone does nothing in a table cell: under
                            auto layout the column grows to the widest cell, so a
                            nowrap description just stretches the table instead
                            of ellipsing. The cap has to be an explicit max-width
                            on an element inside the cell — same reason as the
                            metadata column on the audit log.
                          */}
                          <Stack gap="0" maxW="22rem">
                            <Link
                              to="/$orgSlug/projects/$projectId"
                              search={ISSUE_DEFAULT_SEARCH}
                              params={{ orgSlug: params().orgSlug, projectId: p.id }}
                            >
                              {p.name}
                            </Link>
                            <Show when={p.description}>
                              <Text fontSize="xs" color="fg.muted" truncate>
                                {p.description}
                              </Text>
                            </Show>
                          </Stack>
                        </Table.Cell>
                        <Table.Cell data-label="Open issues" textAlign="right">
                          {p.openIssues}
                        </Table.Cell>
                        <Table.Cell data-actions textAlign="right">
                          <Can session={session()} orgId={org().id} permission="projects.delete">
                            {/*
                              Deleting a project cascades to its issues and cannot
                              be undone, so it asks first. The server does not —
                              confirmation is an interface concern, not an
                              authorization one.
                            */}
                            <ConfirmDialog
                              title={`Delete ${p.name}?`}
                              description={
                                <>
                                  This permanently removes the project and its{" "}
                                  {p.openIssues} open {p.openIssues === 1 ? "issue" : "issues"}.
                                  This cannot be undone.
                                </>
                              }
                              confirmLabel="Delete project"
                              onConfirm={() => onDelete(p.id)}
                              trigger={(triggerProps) => (
                                <Button
                                  {...triggerProps()}
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  colorPalette="red"
                                >
                                  Delete
                                </Button>
                              )}
                            />
                          </Can>
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </For>
                </Table.Body>
              </Table.Root>
            </ResponsiveTable>
          </Show>

          <Pagination
            page={search().page}
            totalPages={totalPages()}
            summary={`Page ${search().page} of ${totalPages()} · ${projects.data?.total ?? 0} projects`}
            onPrevious={() => navigate({ search: (p) => ({ ...p, page: p.page - 1 }) })}
            onNext={() => navigate({ search: (p) => ({ ...p, page: p.page + 1 }) })}
          />
        </Card.Body>
      </Card.Root>
    </>
  );
}
