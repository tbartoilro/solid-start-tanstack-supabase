import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, useRouter } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";
import { Stack } from "styled-system/jsx";
import { CenteredCard, ErrorBanner } from "~/components/page";
import { Button } from "~/components/ui/button";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
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
  /*
   * An accessor, not a destructured value. `useRouteContext()` returns a
   * signal, so pulling `session` out of one call freezes it at mount — and
   * every navigation or `router.invalidate()` republishes that context, which
   * would leave this page showing whichever of the two screens below was
   * chosen at mount rather than the one the current session calls for.
   */
  const context = Route.useRouteContext();
  const session = () => context().session;

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
    <Show
      when={session()}
      fallback={
        <CenteredCard
          title="This link is no longer valid"
          description="Reset links expire. Request a new one to continue."
        >
          <Text fontSize="sm">
            <Link to="/forgot-password">Send another reset link</Link>
          </Text>
        </CenteredCard>
      }
    >
      <CenteredCard title="Choose a new password">
        <form onSubmit={onSubmit}>
          <Stack gap="4">
            <Field.Root required>
              <Field.Label>New password</Field.Label>
              <Input
                type="password"
                autocomplete="new-password"
                required
                minLength={8}
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
              />
              <Field.HelperText>At least 8 characters.</Field.HelperText>
            </Field.Root>

            <ErrorBanner message={error()} />

            <Button type="submit" loading={pending()} loadingText="Saving…" width="full">
              Save password
            </Button>
          </Stack>
        </form>
      </CenteredCard>
    </Show>
  );
}
