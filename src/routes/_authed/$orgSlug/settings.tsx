import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, useRouter } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";
import { updateOrgSettings } from "~/server/rpc/org";

export const Route = createFileRoute("/_authed/$orgSlug/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const params = Route.useParams();
  const { org } = Route.useRouteContext()();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [name, setName] = createSignal(org.name);
  const [status, setStatus] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

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
    </>
  );
}
