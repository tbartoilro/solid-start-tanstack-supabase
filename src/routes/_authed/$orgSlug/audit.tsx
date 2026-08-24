import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { Box } from "styled-system/jsx";
import { z } from "zod";
import { Pagination, TableScroll } from "~/components/data";
import { EmptyState, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import * as Card from "~/components/ui/card";
import * as Table from "~/components/ui/table";
import { Text } from "~/components/ui/text";
import { auditQuery } from "~/lib/queries";

export const Route = createFileRoute("/_authed/$orgSlug/audit")({
  validateSearch: z.object({ page: z.coerce.number().int().min(1).catch(1) }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(auditQuery(params.orgSlug, deps.page)),
  component: AuditPage,
});

function AuditPage() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const audit = useQuery(() => auditQuery(params().orgSlug, search().page));

  const totalPages = () =>
    Math.max(1, Math.ceil((audit.data?.total ?? 0) / (audit.data?.pageSize ?? 50)));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Written by database triggers, not application code — there is no INSERT policy on this table, so entries cannot be forged or rewritten through the API."
      />

      <Card.Root>
        <Card.Body p="0">
          <Show
            when={(audit.data?.entries.length ?? 0) > 0}
            fallback={<EmptyState title="Nothing recorded yet" />}
          >
            <TableScroll minW="40rem">
              <Table.Root size="sm">
                <Table.Head>
                  <Table.Row>
                    <Table.Header>When</Table.Header>
                    <Table.Header>Actor</Table.Header>
                    <Table.Header>Action</Table.Header>
                    <Table.Header>Details</Table.Header>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  <For each={audit.data?.entries}>
                    {(entry) => (
                      <Table.Row>
                        <Table.Cell whiteSpace="nowrap" color="fg.muted">
                          {new Date(entry.createdAt).toLocaleString()}
                        </Table.Cell>
                        <Table.Cell>
                          {entry.actor?.fullName ?? entry.actor?.email ?? "system"}
                        </Table.Cell>
                        <Table.Cell>
                          <Badge size="sm" variant="outline" fontFamily="mono">
                            {entry.action}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell>
                          {/*
                            Metadata is arbitrary trigger-written JSON, so its
                            serialised length is unbounded. The cap has to live
                            on an inner box: under auto table layout a `td`'s
                            own max-width is ignored, so without this one long
                            entry stretches the table far past the scroll
                            container's minimum and squeezes every other column.
                            Two lines then ellipsis keeps rows a uniform height
                            while still showing the start of the payload, which
                            is the part that identifies it; the full value is on
                            the title attribute.
                          */}
                          <Box maxW="24rem">
                            <Text
                              as="code"
                              fontFamily="mono"
                              fontSize="xs"
                              color="fg.muted"
                              wordBreak="break-all"
                              lineClamp={2}
                              title={JSON.stringify(entry.metadata)}
                            >
                              {JSON.stringify(entry.metadata)}
                            </Text>
                          </Box>
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
            summary={`Page ${search().page} of ${totalPages()} · ${audit.data?.total ?? 0} entries`}
            onPrevious={() => navigate({ search: (p) => ({ ...p, page: p.page - 1 }) })}
            onNext={() => navigate({ search: (p) => ({ ...p, page: p.page + 1 }) })}
          />
        </Card.Body>
      </Card.Root>
    </>
  );
}
