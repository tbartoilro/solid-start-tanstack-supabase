import { createListCollection } from "@ark-ui/solid/select";
import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { ChevronsUpDown } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Stack, Wrap } from "styled-system/jsx";
import { z } from "zod";
import { FilterBar, Pagination, TableScroll } from "~/components/data";
import { EmptyState, PageHeader } from "~/components/page";
import { IssueKey, PriorityBadge, StatusBadge } from "~/components/StatusBadge";
import * as Card from "~/components/ui/card";
import * as Checkbox from "~/components/ui/checkbox";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import * as Select from "~/components/ui/select";
import * as Table from "~/components/ui/table";
import { Text } from "~/components/ui/text";
import { issuesQuery, projectsQuery, type IssueFilters } from "~/lib/queries";

const STATUSES = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"] as const;

const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};

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

// Ties the status checkboxes to their heading for assistive tech; a module
// constant because the id has to match in two places and there is only ever one
// of these groups on the page.
const STATUS_GROUP_LABEL_ID = "issues-status-filter-label";

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

  const projectCollection = createMemo(() =>
    createListCollection({
      items: [
        { label: "All projects", value: "" },
        ...(projects.data ?? []).map((p) => ({ label: p.name, value: p.id })),
      ],
    }),
  );

  // Any filter change resets to page 1 — otherwise narrowing the results while
  // on page 7 lands the user on an empty screen.
  const setFilter = (patch: Record<string, unknown>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }) });

  const totalPages = () =>
    Math.max(1, Math.ceil((issues.data?.total ?? 0) / (issues.data?.pageSize ?? 25)));

  return (
    <>
      <PageHeader
        title="Issues"
        description="Filters live in the URL, so any view here is linkable and survives a reload."
      />

      <Card.Root mb="6">
        <Card.Body>
          <FilterBar>
            <Field.Root>
              <Field.Label>Search</Field.Label>
              <Input
                size="sm"
                type="search"
                value={search().q ?? ""}
                placeholder="Title contains…"
                onInput={(e) => setFilter({ q: e.currentTarget.value || undefined })}
              />
            </Field.Root>

            <Select.Root
              size="sm"
              collection={projectCollection()}
              value={[search().project ?? ""]}
              onValueChange={(d) => setFilter({ project: d.value[0] || undefined })}
              positioning={{ sameWidth: true }}
            >
              <Select.Label>Project</Select.Label>
              <Select.Control>
                <Select.Trigger>
                  <Select.ValueText placeholder="All projects" />
                  <Select.IndicatorGroup>
                    <Select.Indicator>
                      <ChevronsUpDown size={16} />
                    </Select.Indicator>
                  </Select.IndicatorGroup>
                </Select.Trigger>
              </Select.Control>
              {/*
                Portalled so the list escapes the filter card: rendered inline it
                inherits the card's stacking and clipping, which puts the options
                behind the table on a narrow screen.
              */}
              <Portal>
                <Select.Positioner>
                  <Select.Content>
                    <For each={projectCollection().items}>
                      {(item) => (
                        <Select.Item item={item}>
                          <Select.ItemText>{item.label}</Select.ItemText>
                          <Select.ItemIndicator />
                        </Select.Item>
                      )}
                    </For>
                  </Select.Content>
                </Select.Positioner>
              </Portal>
              <Select.HiddenSelect />
            </Select.Root>

            {/*
              Six checkboxes are one control, so the group claims the full grid
              row at every breakpoint instead of being crammed into a cell the
              width of the search box. `role="group"` plus the heading id gives a
              screen reader the same grouping the heading gives a sighted user.
            */}
            <Stack gap="2" gridColumn="1 / -1">
              <Text id={STATUS_GROUP_LABEL_ID} fontSize="sm" fontWeight="medium">
                Status
              </Text>
              <Wrap columnGap="4" rowGap="2" role="group" aria-labelledby={STATUS_GROUP_LABEL_ID}>
                <For each={STATUSES}>
                  {(s) => (
                    <Checkbox.Root
                      size="sm"
                      checked={search().status?.includes(s) ?? false}
                      onCheckedChange={(d) => {
                        const current = search().status ?? [];
                        const next = d.checked
                          ? [...current, s]
                          : current.filter((x) => x !== s);
                        setFilter({ status: next.length ? next : undefined });
                      }}
                    >
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      <Checkbox.Label>{STATUS_LABEL[s]}</Checkbox.Label>
                      <Checkbox.HiddenInput />
                    </Checkbox.Root>
                  )}
                </For>
              </Wrap>
            </Stack>
          </FilterBar>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body p="0">
          <Show
            when={(issues.data?.issues.length ?? 0) > 0}
            fallback={
              <EmptyState
                title="No issues match these filters"
                description="Try clearing the search box or widening the status selection."
              />
            }
          >
            <TableScroll minW="44rem">
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
                        <Table.Cell>
                          <IssueKey>{`${issue.project?.key}-${issue.number}`}</IssueKey>
                        </Table.Cell>
                        {/*
                          `anywhere` rather than `break-word`: only the former
                          also lowers the cell's min-content width, which is
                          what stops a title with no spaces in it — a pasted URL
                          or stack frame — from setting the width of the whole
                          table and turning the scroll container into a
                          kilometre of sideways travel.
                        */}
                        <Table.Cell overflowWrap="anywhere">{issue.title}</Table.Cell>
                        <Table.Cell>
                          <StatusBadge status={issue.status} />
                        </Table.Cell>
                        <Table.Cell>
                          <PriorityBadge priority={issue.priority} />
                        </Table.Cell>
                        <Table.Cell>
                          {issue.assignee?.fullName ?? issue.assignee?.email ?? "—"}
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </For>
                </Table.Body>
              </Table.Root>
            </TableScroll>
          </Show>

          <Pagination
            page={search().page}
            totalPages={totalPages()}
            summary={`Page ${search().page} of ${totalPages()} · ${issues.data?.total ?? 0} issues`}
            onPrevious={() => navigate({ search: (p) => ({ ...p, page: p.page - 1 }) })}
            onNext={() => navigate({ search: (p) => ({ ...p, page: p.page + 1 }) })}
          />
        </Card.Body>
      </Card.Root>
    </>
  );
}
