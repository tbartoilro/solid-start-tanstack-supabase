import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, useRouter } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";
import { Can } from "~/components/Can";
import { exportOrganization, updateOrgSettings } from "~/server/rpc/org";

export const Route = createFileRoute("/_authed/$orgSlug/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const params = Route.useParams();
  const { org } = Route.useRouteContext()();
  const queryClient = useQueryClient();
  const router = useRouter();

  const { session } = Route.useRouteContext()();

  const [name, setName] = createSignal(org.name);
  const [status, setStatus] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [exporting, setExporting] = createSignal(false);
  const [exportError, setExportError] = createSignal<string | null>(null);

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    try {
      await updateOrgSettings({ orgSlug: params().orgSlug, name: name() });
      // The org name is part of the session payload, so that cache entry is
      // stale now — invalidate it and let the router re-resolve context.
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      await router.invalidate();
      setStatus("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  }

  /**
   * Downloads the export as a file.
   *
   * The whole payload arrives in memory, which is fine at template scale and
   * would not be for a large tenant — a production version should stream it.
   * The server rate-limits this to 3 per hour per organization, so a 429 is a
   * normal outcome rather than a bug; it is surfaced as the message it carries.
   */
  async function onExport() {
    setExportError(null);
    setExporting(true);
    try {
      const data = await exportOrganization({ orgSlug: params().orgSlug });

      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${params().orgSlug}-export.json`;
      link.click();
      // Revoked immediately: the click has already handed the blob to the
      // browser's download machinery, and holding the URL leaks the payload.
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Could not export.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <header class="page-header">
        <h1>Settings</h1>
        <p class="muted">
          Only the <code>org.settings</code> permission reaches this page, and{" "}
          <code>updateOrgSettings</code> re-checks it server-side regardless.
        </p>
      </header>

      <form class="card auth-form" onSubmit={onSubmit}>
        <label>
          Organization name
          <input value={name()} onInput={(e) => setName(e.currentTarget.value)} required />
        </label>

        <Show when={error()}>
          <p class="error" role="alert">
            {error()}
          </p>
        </Show>
        <Show when={status()}>
          <p class="success">{status()}</p>
        </Show>

        <button type="submit">Save</button>
      </form>

      <Can session={session} orgId={org.id} permission="org.export">
        <section class="card">
          <h2>Export</h2>
          <p class="muted">
            Everything this organization owns, as JSON — members, projects, issues, invitations
            and the audit trail. Invitation tokens are excluded: an export is a record of who was
            invited, not a bundle of live credentials.
          </p>

          <Show when={exportError()}>
            <p class="error" role="alert">
              {exportError()}
            </p>
          </Show>

          <button type="button" disabled={exporting()} onClick={() => void onExport()}>
            {exporting() ? "Preparing…" : "Export organization data"}
          </button>
        </section>
      </Can>
    </>
  );
}
