import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";
import { z } from "zod";
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
    <main class="centered">
      <Show
        when={!confirmSent()}
        fallback={
          <div class="card">
            <h1>Check your email</h1>
            <p>
              We sent a confirmation link to <strong>{email()}</strong>. Open it to finish
              creating your account.
            </p>
          </div>
        }
      >
        <form class="card auth-form" onSubmit={onSubmit}>
          <h1>Create an account</h1>

          <label>
            Full name
            <input
              type="text"
              autocomplete="name"
              required
              value={fullName()}
              onInput={(e) => setFullName(e.currentTarget.value)}
            />
          </label>

          <label>
            Email
            <input
              type="email"
              autocomplete="email"
              required
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
            />
          </label>

          <label>
            Password
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
            {pending() ? "Creating account…" : "Create account"}
          </button>

          <p class="hint">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </Show>
    </main>
  );
}
