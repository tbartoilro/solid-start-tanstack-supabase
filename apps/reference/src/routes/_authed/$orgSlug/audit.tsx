import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { Box } from "styled-system/jsx";
import { z } from "zod";
import { totalPages as pages } from "@orgadmin/core";
import { Pagination, ResponsiveTable } from "~/components/data";
import { EmptyState, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import * as Card from "~/components/ui/card";
import * as Table from "~/components/ui/table";
import { Text } from "~/components/ui/text";
import { auditQuery } from "~/lib/queries";
import { auditResource, AUDIT_SORTS, type AuditSort } from "~/resources/audit";
import { SortableHeader } from "~/components/SortableHeader";

/**
 * The sort lives in the URL, like the page already does, so an ordering is
 * something you can link to and come back to. `.catch()` on every field keeps a
 * hand-edited URL renderable — the enum is generated from the descriptor, so a
 * value the server would refuse cannot be written here without a type error.
 */
const searchSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  sort: z.enum(AUDIT_SORTS).catch(auditResource.defaultSort.column as AuditSort),
  dir: z.enum(["asc", "desc"]).catch(auditResource.defaultSort.dir),
});

export const Route = createFileRoute("/_authed/$orgSlug/audit")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(auditQuery(params.orgSlug, deps)),
  component: AuditPage,
});

function AuditPage() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const audit = useQuery(() => auditQuery(params().orgSlug, search()));

  const totalPages = () => pages(audit.data?.total ?? 0, audit.data?.pageSize ?? 50);

  /*
   * Changing the sort resets to page 1. Staying on page 9 of a re-ordered list
   * shows rows with no relationship to what was on screen a moment ago, which
   * reads as data loss rather than a re-sort.
   */
  const setSort = (next: { column: string; dir: "asc" | "desc" }) =>
    void navigate({ search: { page: 1, sort: next.column as AuditSort, dir: next.dir } });

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
            <ResponsiveTable>
              <Table.Root size="sm">
                <Table.Head>
                  <Table.Row>
                    <For each={auditResource.columns}>
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
                  <For each={audit.data?.entries}>
                    {(entry) => (
                      <Table.Row>
                        <Table.Cell data-label="When" whiteSpace="nowrap" color="fg.muted">
                          {new Date(entry.createdAt).toLocaleString()}
                        </Table.Cell>
                        <Table.Cell data-label="Actor">
                          {entry.actor?.fullName ?? entry.actor?.email ?? "system"}
                        </Table.Cell>
                        {/*
                          The action names the event, so it heads the card. A
                          timestamp would be the obvious first column on a
                          desktop table but it identifies nothing on its own —
                          scanning a phone screen you are looking for what
                          happened, then when.
                        */}
                        <Table.Cell data-primary>
                          <Badge size="sm" variant="outline" fontFamily="mono">
                            {entry.action}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell data-label="Details" data-block>
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
                          {/*
                            Narrower at `lg` than further up. This is the only
                            table wide enough to still overflow once the others
                            fit: When, Actor and Action need roughly 440px, and
                            at 1024px the sidebar leaves about 704px, so a 24rem
                            Details column pushed the total past the container
                            and it scrolled. Widened again at `xl`, where there
                            is room for it.
                          */}
                          <Box maxW={{ base: "24rem", lg: "15rem", xl: "24rem" }}>
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
            </ResponsiveTable>
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
