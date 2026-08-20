import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { z } from "zod";
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
      <header class="page-header">
        <h1>Audit log</h1>
        <p class="muted">
          Written by database triggers, not application code — there is no INSERT policy on
          this table, so entries cannot be forged or rewritten through the API.
        </p>
      </header>

      <section class="card">
        <table class="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            <For each={audit.data?.entries}>
              {(entry) => (
                <tr>
                  <td class="muted">{new Date(entry.createdAt).toLocaleString()}</td>
                  <td>{entry.actor?.fullName ?? entry.actor?.email ?? "system"}</td>
                  <td>
                    <span class="key">{entry.action}</span>
                  </td>
                  <td class="muted">
                    <code>{JSON.stringify(entry.metadata)}</code>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>

        <Show when={(audit.data?.entries.length ?? 0) === 0}>
          <p class="muted">Nothing recorded yet.</p>
        </Show>

        <div class="pagination">
          <button
            type="button"
            disabled={search().page <= 1}
            onClick={() => navigate({ search: (p) => ({ page: p.page - 1 }) })}
          >
            Previous
          </button>
          <span class="muted">
            Page {search().page} of {totalPages()}
          </span>
          <button
            type="button"
            disabled={search().page >= totalPages()}
            onClick={() => navigate({ search: (p) => ({ page: p.page + 1 }) })}
          >
            Next
          </button>
        </div>
      </section>
    </>
  );
}
