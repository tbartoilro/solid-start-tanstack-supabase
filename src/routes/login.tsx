import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/solid-router";
import { createSignal } from "solid-js";
import { Box, Stack } from "styled-system/jsx";
import { z } from "zod";
import { CenteredCard, ErrorBanner } from "~/components/page";
import { Button } from "~/components/ui/button";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { signInWithPassword } from "~/server/rpc/auth";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  // Search params are parsed, not cast. `?redirect=` arrives as untrusted
  // input like any other request data.
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const search = Route.useSearch();

  const [email, setEmail] = createSignal("owner@acme.test");
  const [password, setPassword] = createSignal("password123");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      await signInWithPassword({ email: email(), password: password() });

      // There are two caches here and both must be cleared, in this order.
      //
      // `removeQueries`, not `invalidateQueries`: invalidation only marks an
      // entry stale and schedules a refetch for *active observers*. Nothing on
      // this page observes the session — it is read by the root route's
      // beforeLoad via ensureQueryData — so an invalidated entry would simply
      // be handed back unchanged, the guard would still see `null`, and the
      // router would bounce straight back to /login. Dropping the entry forces
      // the refetch.
      queryClient.removeQueries({ queryKey: ["session"] });
      await router.invalidate();

      const target = search().redirect;
      // Only same-origin paths are followed, so `?redirect=https://evil.test`
      // cannot turn this form into an open redirect.
      const safe = target && target.startsWith("/") && !target.startsWith("//") ? target : "/";
      await router.navigate({ href: safe });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setPending(false);
    }
  }

  return (
    <CenteredCard title="Sign in" description="Welcome back.">
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

          <Field.Root required>
            <Field.Label>Password</Field.Label>
            <Input
              type="password"
              autocomplete="current-password"
              required
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </Field.Root>

          <ErrorBanner message={error()} />

          <Button type="submit" loading={pending()} loadingText="Signing in…" width="full">
            Sign in
          </Button>

          <Text fontSize="sm" color="fg.muted" textAlign="center">
            <Link to="/forgot-password">Forgot your password?</Link> ·{" "}
            <Link to="/signup">Create an account</Link>
          </Text>

          <Box borderTopWidth="1px" borderColor="border.default" pt="4">
            <Text fontSize="xs" color="fg.muted" lineHeight="1.8">
              Seeded accounts, all with password <code>password123</code>:<br />
              <code>owner@acme.test</code>, <code>admin@acme.test</code>,{" "}
              <code>member@acme.test</code>, <code>viewer@acme.test</code>,{" "}
              <code>outsider@globex.test</code>
            </Text>
          </Box>
        </Stack>
      </form>
    </CenteredCard>
  );
}
