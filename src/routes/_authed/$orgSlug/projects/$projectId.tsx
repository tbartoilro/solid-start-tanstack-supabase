import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { createSignal, For, Show } from "solid-js";
import { Can } from "~/components/Can";
import { CreateBar, ResponsiveTable } from "~/components/data";
import { EmptyState, ErrorBanner, PageHeader } from "~/components/page";
import { IssueKey, PriorityBadge, StatusBadge } from "~/components/StatusBadge";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import * as Table from "~/components/ui/table";
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
  /*
   * Accessors, not destructured values. `useRouteContext()` returns a signal,
   * and this component does not remount when only `$orgSlug` changes, so
   * reading it once at setup would leave the gate below judging the tenant the
   * user switched away from.
   */
  const context = Route.useRouteContext();
  const session = () => context().session;
  const org = () => context().org;
  const queryClient = useQueryClient();

  const project = useQuery(() => projectQuery(params().orgSlug, params().projectId));
  const issues = useQuery(() =>
    issuesQuery(params().orgSlug, { projectId: params().projectId, page: 1 }),
  );

  const [title, setTitle] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  async function onCreate(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
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
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        title={project.data?.name ?? "Project"}
        description={project.data?.description ?? "No description."}
        // The key is a single short token, so it wraps to its own line under a
        // long project name rather than breaking mid-identifier.
        actions={<Show when={project.data}>{(p) => <IssueKey>{p().key}</IssueKey>}</Show>}
      />

      <ErrorBanner message={error()} />

      <Can session={session()} orgId={org().id} permission="issues.write">
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
                    Create issue
                  </Button>
                }
              >
                {/* CreateBar pairs fields two to a row; this form has one, so it
                    spans both rather than stopping halfway across the card. */}
                <Field.Root required gridColumn={{ sm: "span 2" }}>
                  <Field.Label>New issue</Field.Label>
                  <Input
                    size="sm"
                    value={title()}
                    onInput={(e) => setTitle(e.currentTarget.value)}
                    placeholder="What needs doing?"
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
            when={(issues.data?.issues.length ?? 0) > 0}
            fallback={<EmptyState title="No issues in this project yet" />}
          >
            <ResponsiveTable>
              <Table.Root size="sm">
                <Table.Head>
                  <Table.Row>
                    <Table.Header>Issue</Table.Header>
                    <Table.Header>Title</Table.Header>
                    <Table.Header>Status</Table.Header>
                    <Table.Header>Priority</Table.Header>
                    <Table.Header>Assignee</Table.Header>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  <For each={issues.data?.issues}>
                    {(issue) => (
                      <Table.Row>
                        <Table.Cell data-label="Issue">
                          <IssueKey>{`${project.data?.key}-${issue.number}`}</IssueKey>
                        </Table.Cell>
                        {/* See the note on the same column in issues.tsx:
                            `anywhere` also lowers min-content width, so an
                            unbroken title cannot widen the table.

                            It also leads the card. The key is the identifier,
                            but it is the title people actually scan a list for,
                            and the key still reads fine as a labelled line. */}
                        <Table.Cell data-primary overflowWrap="anywhere">
                          {issue.title}
                        </Table.Cell>
                        <Table.Cell data-label="Status">
                          <StatusBadge status={issue.status} />
                        </Table.Cell>
                        <Table.Cell data-label="Priority">
                          <PriorityBadge priority={issue.priority} />
                        </Table.Cell>
                        <Table.Cell data-label="Assignee">
                          {issue.assignee?.fullName ?? issue.assignee?.email ?? "—"}
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </For>
                </Table.Body>
              </Table.Root>
            </ResponsiveTable>
          </Show>
        </Card.Body>
      </Card.Root>
    </>
  );
}
