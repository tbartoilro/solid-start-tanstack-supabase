import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";
import { Stack } from "styled-system/jsx";
import { z } from "zod";
import { CenteredCard, ErrorBanner } from "~/components/page";
import { Button } from "~/components/ui/button";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { signUpWithPassword } from "~/server/rpc/auth";

const searchSchema = z.object({
  /** Preserved through signup so an invited user lands back on their invite. */
  invite: z.string().optional(),
});

export const Route = createFileRoute("/signup")({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/" });
  },
  component: SignUpPage,
});

function SignUpPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const search = Route.useSearch();

  const [fullName, setFullName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [confirmSent, setConfirmSent] = createSignal(false);
  const [pending, setPending] = createSignal(false);

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const { needsConfirmation } = await signUpWithPassword({
        fullName: fullName(),
        email: email(),
        password: password(),
      });

      // With email confirmation on, there is no session yet — the user has to
      // come back through the link, so there is nothing to navigate to.
      if (needsConfirmation) {
        setConfirmSent(true);
        return;
      }

      // Same two-cache dance as the login form; see the comment in login.tsx
      // for why the session entry is removed rather than invalidated.
      queryClient.removeQueries({ queryKey: ["session"] });
      await router.invalidate();

      const invite = search().invite;
      await router.navigate(
        invite ? { to: "/accept-invite", search: { token: invite } } : { to: "/" },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Show
      when={!confirmSent()}
      fallback={
        <CenteredCard title="Check your email">
          <Text>
            We sent a confirmation link to <strong>{email()}</strong>. Open it to finish
            creating your account.
          </Text>
        </CenteredCard>
      }
    >
      <CenteredCard title="Create an account" description="Start tracking work in minutes.">
        <form onSubmit={onSubmit}>
          <Stack gap="4">
            <Field.Root required>
              <Field.Label>Full name</Field.Label>
              <Input
                type="text"
                autocomplete="name"
                required
                value={fullName()}
                onInput={(e) => setFullName(e.currentTarget.value)}
              />
            </Field.Root>

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

            <Field.Root required>
              <Field.Label>Password</Field.Label>
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

            <Button type="submit" loading={pending()} loadingText="Creating account…" width="full">
              Create account
            </Button>

            <Text fontSize="sm" color="fg.muted" textAlign="center">
              Already have an account? <Link to="/login">Sign in</Link>
            </Text>
          </Stack>
        </form>
      </CenteredCard>
    </Show>
  );
}
