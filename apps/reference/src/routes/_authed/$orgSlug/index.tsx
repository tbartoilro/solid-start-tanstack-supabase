import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { Grid, HStack, Stack } from "styled-system/jsx";
import { EmptyState, PageHeader, StatTile } from "~/components/page";
import { IssueKey, StatusBadge } from "~/components/StatusBadge";
import { Badge } from "~/components/ui/badge";
import * as Card from "~/components/ui/card";
import { Text } from "~/components/ui/text";
import { issuesQuery, projectsQuery, type IssueFilters } from "~/lib/queries";
import { PROJECT_DEFAULT_SEARCH } from "~/resources/projects";
import { ISSUE_DEFAULT_SEARCH } from "~/resources/issues";

/**
 * The statuses an issue counts as "open" in.
 *
 * Mirrors OPEN_STATUSES in src/server/services/projects.ts. Duplicated rather
 * than imported because that module is server-only, and the alternative — a
 * dedicated stats endpoint — is more machinery than one tile is worth.
 */
const OPEN: IssueFilters["status"] = ["backlog", "todo", "in_progress", "in_review"];
const openIssuesFilter: IssueFilters = { status: OPEN, page: 1 };

export const Route = createFileRoute("/_authed/$orgSlug/")({
  // Both datasets are prefetched during SSR, so the overview arrives fully
  // rendered rather than as a page full of spinners.
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(projectsQuery(params.orgSlug, PROJECT_DEFAULT_SEARCH)),
      context.queryClient.ensureQueryData(issuesQuery(params.orgSlug, { page: 1 })),
      context.queryClient.ensureQueryData(issuesQuery(params.orgSlug, openIssuesFilter)),
    ]);
  },
  component: Overview,
});

function Overview() {
  const params = Route.useParams();
  /*
   * An accessor, not a destructured value. This component does not remount when
   * only `$orgSlug` changes, so pulling `org` out of the context signal once at
   * setup would leave the heading naming the organization you switched away
   * from. See the longer note in routes/_authed/$orgSlug.tsx.
   */
  const context = Route.useRouteContext();
  const org = () => context().org;

  const projects = useQuery(() => projectsQuery(params().orgSlug, PROJECT_DEFAULT_SEARCH));
  const issues = useQuery(() => issuesQuery(params().orgSlug, { page: 1 }));

  /*
   * Counted by the database, not by summing the projects on screen.
   *
   * This used to add up `openIssues` across `projects.data`, which is one page
   * of projects — so past the 25th project the headline number silently
   * undercounted, and looked plausible while doing it. The paged endpoint
   * already reports an exact total for any filter, so asking it for the open
   * statuses is both correct and cheaper than carrying counts per project.
   */
  const openIssues = useQuery(() => issuesQuery(params().orgSlug, openIssuesFilter));

  return (
    <>
      <PageHeader
        title={org().name}
        description={
          <>
            You are signed in as <Badge size="sm">{org().role}</Badge>
          </>
        }
      />

      {/* Three across even on a phone — see StatTile for why they are compact. */}
      <Grid columns={3} gap={{ base: "2", md: "4" }} mb="6">
        <StatTile label="Projects" value={projects.data?.total ?? 0} />
        <StatTile label="Open issues" value={openIssues.data?.total ?? 0} />
        <StatTile label="Total issues" value={issues.data?.total ?? 0} />
      </Grid>

      <Stack gap="6">
        <Card.Root>
          <Card.Header>
            <Card.Title>Projects</Card.Title>
          </Card.Header>
          <Card.Body>
            <Show
              when={(projects.data?.projects.length ?? 0) > 0}
              fallback={
                <EmptyState
                  title="No projects yet"
                  description="Create one from the Projects page to start tracking work."
                />
              }
            >
              <Stack gap="0" divideY="1px" divideColor="border.default">
                <For each={projects.data?.projects}>
                  {(p) => (
                    <HStack justifyContent="space-between" gap="4" py="3">
                      <HStack gap="3" minW="0">
                        <IssueKey>{p.key}</IssueKey>
                        <Link
                          to="/$orgSlug/projects/$projectId"
                              search={ISSUE_DEFAULT_SEARCH}
                          params={{ orgSlug: params().orgSlug, projectId: p.id }}
                        >
                          <Text truncate>{p.name}</Text>
                        </Link>
                      </HStack>
                      <Text fontSize="sm" color="fg.muted" whiteSpace="nowrap">
                        {p.openIssues} open
                      </Text>
                    </HStack>
                  )}
                </For>
              </Stack>
            </Show>
          </Card.Body>
        </Card.Root>

        <Card.Root>
          <Card.Header>
            <Card.Title>Recently updated issues</Card.Title>
          </Card.Header>
          <Card.Body>
            <Show
              when={(issues.data?.issues.length ?? 0) > 0}
              fallback={<EmptyState title="Nothing updated yet" />}
            >
              <Stack gap="0" divideY="1px" divideColor="border.default">
                <For each={issues.data?.issues.slice(0, 5)}>
                  {(issue) => (
                    <HStack justifyContent="space-between" gap="4" py="3">
                      <HStack gap="3" minW="0">
                        <IssueKey>{`${issue.project?.key}-${issue.number}`}</IssueKey>
                        <Text truncate>{issue.title}</Text>
                      </HStack>
                      <StatusBadge status={issue.status} />
                    </HStack>
                  )}
                </For>
              </Stack>
            </Show>
          </Card.Body>
        </Card.Root>
      </Stack>
    </>
  );
}
