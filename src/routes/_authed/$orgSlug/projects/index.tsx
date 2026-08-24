import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { createSignal, For, Show } from "solid-js";
import { Stack } from "styled-system/jsx";
import { Can } from "~/components/Can";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { CreateBar, TableScroll } from "~/components/data";
import { EmptyState, ErrorBanner, PageHeader } from "~/components/page";
import { IssueKey } from "~/components/StatusBadge";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import * as Table from "~/components/ui/table";
import { Text } from "~/components/ui/text";
import { projectsQuery } from "~/lib/queries";
import { createProject, deleteProject } from "~/server/rpc/projects";

export const Route = createFileRoute("/_authed/$orgSlug/projects/")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(projectsQuery(params.orgSlug)),
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
      <PageHeader title="Projects" description="Every project in this organization." />

      <ErrorBanner message={error()} />

      {/*
        The form is hidden without projects.write, and createProject() checks
        the same permission server-side. Both, always.
      */}
      <Can session={session()} orgId={org().id} permission="projects.write">
        <Card.Root mb="6">
          <Card.Body>
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
            when={(projects.data?.length ?? 0) > 0}
            fallback={
              <EmptyState
                title="No projects yet"
                description="Projects group issues. Create the first one above."
              />
            }
          >
            {/* Four columns do not survive a 390px viewport; scroll rather than wrap. */}
            <TableScroll minW="40rem">
              <Table.Root size="sm">
                <Table.Head>
                  <Table.Row>
                    <Table.Header>Key</Table.Header>
                    <Table.Header>Name</Table.Header>
                    <Table.Header textAlign="right">Open issues</Table.Header>
                    <Table.Header />
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  <For each={projects.data}>
                    {(p) => (
                      <Table.Row>
                        <Table.Cell>
                          <IssueKey>{p.key}</IssueKey>
                        </Table.Cell>
                        <Table.Cell>
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
                        <Table.Cell textAlign="right">{p.openIssues}</Table.Cell>
                        <Table.Cell textAlign="right">
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
            </TableScroll>
          </Show>
        </Card.Body>
      </Card.Root>
    </>
  );
}
