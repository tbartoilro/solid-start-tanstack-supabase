import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, redirect, useRouter } from "@tanstack/solid-router";
import { createMemo, createSignal, Show } from "solid-js";
import { slugify } from "~/lib/slug";
import { createOrganization } from "~/server/rpc/org";

export const Route = createFileRoute("/new-org")({
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: "/login" });
  },
  component: NewOrgPage,
});

function NewOrgPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  const slug = createMemo(() => slugify(name()));

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const org = await createOrganization({ name: name() });

      // The server refreshed the access token so the new membership is in the
      // `orgs` claim; the cached session still predates it, so drop it and let
      // the root route refetch before we navigate into the org.
      queryClient.removeQueries({ queryKey: ["session"] });
      await router.invalidate();

      await router.navigate({ to: "/$orgSlug", params: { orgSlug: org.slug } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the organization.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main class="centered">
      <form class="card auth-form" onSubmit={onSubmit}>
        <h1>Create an organization</h1>

        <label>
          Organization name
          <input
            type="text"
            required
            maxLength={100}
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>

        <Show when={slug()}>
          <p class="hint">
            URL: <code>/{slug()}</code>
          </p>
        </Show>

        <Show when={error()}>
          <p class="error" role="alert">
            {error()}
          </p>
        </Show>

        <button type="submit" disabled={pending() || !slug()}>
          {pending() ? "Creating…" : "Create organization"}
        </button>

        <p class="hint">You will be its owner.</p>
      </form>
    </main>
  );
}
