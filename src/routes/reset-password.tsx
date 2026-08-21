import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, useRouter } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";
import { updatePassword } from "~/server/rpc/auth";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

/**
 * Where the recovery link lands.
 *
 * Following that link signs the user in, so by the time this renders there is a
 * session and `updatePassword` can act on it. If there is no session — a link
 * that expired, or someone navigating here directly — the guidance below points
 * back to requesting a fresh one rather than showing a form that cannot work.
 */
function ResetPasswordPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = Route.useRouteContext()();

  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      await updatePassword({ password: password() });

      queryClient.removeQueries({ queryKey: ["session"] });
      await router.invalidate();
      await router.navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the password.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main class="centered">
      <Show
        when={session}
        fallback={
          <div class="card">
            <h1>This link is no longer valid</h1>
            <p class="muted">Reset links expire. Request a new one to continue.</p>
            <p class="hint">
              <Link to="/forgot-password">Send another reset link</Link>
            </p>
          </div>
        }
      >
        <form class="card auth-form" onSubmit={onSubmit}>
          <h1>Choose a new password</h1>

          <label>
            New password
            <input
              type="password"
              autocomplete="new-password"
              required
              minLength={8}
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </label>

          <Show when={error()}>
            <p class="error" role="alert">
              {error()}
            </p>
          </Show>

          <button type="submit" disabled={pending()}>
            {pending() ? "Saving…" : "Save password"}
          </button>
        </form>
      </Show>
    </main>
  );
}
