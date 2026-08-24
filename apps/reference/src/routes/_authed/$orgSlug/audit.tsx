import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import type { RowSelectionState } from "@tanstack/solid-table";
import { createSignal, Show } from "solid-js";
import { z } from "zod";
import { totalPages as pages } from "@orgadmin/core";
import { DataTable } from "~/components/DataTable";
import { Pagination } from "~/components/data";
import { BulkBar } from "~/components/BulkBar";
import { EmptyState, ErrorBanner, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { downloadText } from "~/lib/download";
import { exportAuditEntries } from "~/server/rpc/bulk";
import * as Card from "~/components/ui/card";
import { auditQuery } from "~/lib/queries";
import { auditResource, AUDIT_SORTS, type AuditSort } from "~/resources/audit";

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

  /*
   * Selection lives here rather than inside the table, and is keyed by row id,
   * so it survives paging and re-sorting: you can select entries on page 1,
   * page 4 and page 9 and export all of them at once. That is the only version
   * of bulk worth having on a list this long.
   */
  const [selection, setSelection] = createSignal<RowSelectionState>({});
  const [error, setError] = createSignal<string | null>(null);
  const [exporting, setExporting] = createSignal(false);

  async function downloadSelected(ids: string[]) {
    setError(null);
    setExporting(true);
    try {
      const result = await exportAuditEntries({ orgSlug: params().orgSlug, ids });
      downloadText(result.csv, result.filename, "text/csv;charset=utf-8");
      setSelection({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export those entries.");
    } finally {
      setExporting(false);
    }
  }

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

      <ErrorBanner message={error()} />

      <Card.Root>
        <Card.Body p="0">
          <BulkBar selection={selection} onClear={() => setSelection({})} noun="entries">
            {(ids) => (
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={exporting()}
                onClick={() => void downloadSelected(ids)}
              >
                Download CSV
              </Button>
            )}
          </BulkBar>

          <Show
            when={(audit.data?.entries.length ?? 0) > 0}
            fallback={<EmptyState title="Nothing recorded yet" />}
          >
            <DataTable
              descriptor={auditResource}
              rows={() => audit.data?.entries}
              context={() => undefined}
              sort={() => ({ column: search().sort, dir: search().dir })}
              onSortChange={setSort}
              selection={{ value: selection, onChange: setSelection }}
            />
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
