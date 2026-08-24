import { createFileRoute, Link } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";
import { Stack } from "styled-system/jsx";
import { CenteredCard, ErrorBanner } from "~/components/page";
import { Button } from "~/components/ui/button";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { requestPasswordReset } from "~/server/rpc/auth";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = createSignal("");
  const [sent, setSent] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      await requestPasswordReset({ email: email() });
      // Succeeds regardless of whether the address exists — see the RPC.
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reset link.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Show
      when={!sent()}
      fallback={
        <CenteredCard title="Check your email">
          <Stack gap="4">
            <Text>
              If an account exists for <strong>{email()}</strong>, a reset link is on its way.
            </Text>
            <Text fontSize="sm" color="fg.muted">
              <Link to="/login">Back to sign in</Link>
            </Text>
          </Stack>
        </CenteredCard>
      }
    >
      <CenteredCard
        title="Reset your password"
        description="We will email you a link to choose a new one."
      >
        <form onSubmit={onSubmit}>
          <Stack gap="4">
            <Field.Root required>
              <Field.Label>Email</Field.Label>
              <Input
                type="email"
                autocomplete="email"
                required
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
              />
            </Field.Root>

            <ErrorBanner message={error()} />

            <Button type="submit" loading={pending()} loadingText="Sending…" width="full">
              Send reset link
            </Button>

            <Text fontSize="sm" color="fg.muted" textAlign="center">
              <Link to="/login">Back to sign in</Link>
            </Text>
          </Stack>
        </form>
      </CenteredCard>
    </Show>
  );
}
