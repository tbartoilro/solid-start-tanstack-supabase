import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { Grid, HStack, Stack } from "styled-system/jsx";
import { EmptyState, PageHeader, StatTile } from "~/components/page";
import { IssueKey, StatusBadge } from "~/components/StatusBadge";
import { Badge } from "~/components/ui/badge";
import * as Card from "~/components/ui/card";
import { Text } from "~/components/ui/text";
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
  /*
   * An accessor, not a destructured value. This component does not remount when
   * only `$orgSlug` changes, so pulling `org` out of the context signal once at
   * setup would leave the heading naming the organization you switched away
   * from. See the longer note in routes/_authed/$orgSlug.tsx.
   */
  const context = Route.useRouteContext();
  const org = () => context().org;

  const projects = useQuery(() => projectsQuery(params().orgSlug));
  const issues = useQuery(() => issuesQuery(params().orgSlug, { page: 1 }));

  const openCount = () => (projects.data ?? []).reduce((sum, p) => sum + p.openIssues, 0);

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
        <StatTile label="Projects" value={projects.data?.length ?? 0} />
        <StatTile label="Open issues" value={openCount()} />
        <StatTile label="Total issues" value={issues.data?.total ?? 0} />
      </Grid>

      <Stack gap="6">
        <Card.Root>
          <Card.Header>
            <Card.Title>Projects</Card.Title>
          </Card.Header>
          <Card.Body>
            <Show
              when={(projects.data?.length ?? 0) > 0}
              fallback={
                <EmptyState
                  title="No projects yet"
                  description="Create one from the Projects page to start tracking work."
                />
              }
            >
              <Stack gap="0" divideY="1px" divideColor="border.default">
                <For each={projects.data}>
                  {(p) => (
                    <HStack justifyContent="space-between" gap="4" py="3">
                      <HStack gap="3" minW="0">
                        <IssueKey>{p.key}</IssueKey>
                        <Link
                          to="/$orgSlug/projects/$projectId"
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
