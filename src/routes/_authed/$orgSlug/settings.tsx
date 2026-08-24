import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, useRouter } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";
import { Box, Stack } from "styled-system/jsx";
import { Can } from "~/components/Can";
import { ErrorBanner, PageHeader, SuccessBanner } from "~/components/page";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { exportOrganization, updateOrgSettings } from "~/server/rpc/org";

export const Route = createFileRoute("/_authed/$orgSlug/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const params = Route.useParams();
  /*
   * Accessors, not destructured values. `useRouteContext()` returns a signal,
   * and this component is reused when only `$orgSlug` changes, so reading it
   * once at setup would leave the page describing the organization you left.
   */
  const context = Route.useRouteContext();
  const session = () => context().session;
  const org = () => context().org;
  const queryClient = useQueryClient();
  const router = useRouter();

  const [name, setName] = createSignal(org().name);
  const [status, setStatus] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);
  const [exportError, setExportError] = createSignal<string | null>(null);

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setSaving(true);
    try {
      await updateOrgSettings({ orgSlug: params().orgSlug, name: name() });
      // The org name is part of the session payload, so that cache entry is
      // stale now — invalidate it and let the router re-resolve context.
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      await router.invalidate();
      setStatus("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
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
      <PageHeader
        title="Settings"
        description="Only the org.settings permission reaches this page, and updateOrgSettings re-checks it server-side regardless."
      />

      <Card.Root mb="6" maxW="34rem">
        <Card.Header>
          <Card.Title>General</Card.Title>
        </Card.Header>
        <Card.Body>
          <form onSubmit={onSubmit}>
            <Stack gap="4">
              <Field.Root required>
                <Field.Label>Organization name</Field.Label>
                <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} required />
              </Field.Root>

              <ErrorBanner message={error()} />
              <SuccessBanner message={status()} />

              <Box>
                <Button type="submit" loading={saving()}>
                  Save
                </Button>
              </Box>
            </Stack>
          </form>
        </Card.Body>
      </Card.Root>

      <Can session={session()} orgId={org().id} permission="org.export">
        <Card.Root maxW="34rem">
          <Card.Header>
            <Card.Title>Export</Card.Title>
            <Card.Description>
              Everything this organization owns, as JSON — members, projects, issues, invitations
              and the audit trail. Invitation tokens are excluded: an export is a record of who
              was invited, not a bundle of live credentials.
            </Card.Description>
          </Card.Header>
          <Card.Body>
            <Stack gap="4">
              <ErrorBanner message={exportError()} />
              <Box>
                <Button
                  type="button"
                  variant="outline"
                  loading={exporting()}
                  loadingText="Preparing…"
                  onClick={() => void onExport()}
                >
                  Export organization data
                </Button>
              </Box>
              <Text fontSize="xs" color="fg.muted">
                Limited to 3 exports per hour for this organization.
              </Text>
            </Stack>
          </Card.Body>
        </Card.Root>
      </Can>
    </>
  );
}
