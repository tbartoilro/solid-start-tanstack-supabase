import { createFileRoute, Link } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";
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
    <main class="centered">
      <Show
        when={!sent()}
        fallback={
          <div class="card">
            <h1>Check your email</h1>
            <p>
              If an account exists for <strong>{email()}</strong>, a reset link is on its way.
            </p>
            <p class="hint">
              <Link to="/login">Back to sign in</Link>
            </p>
          </div>
        }
      >
        <form class="card auth-form" onSubmit={onSubmit}>
          <h1>Reset your password</h1>

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

          <Show when={error()}>
            <p class="error" role="alert">
              {error()}
            </p>
          </Show>

          <button type="submit" disabled={pending()}>
            {pending() ? "Sending…" : "Send reset link"}
          </button>

          <p class="hint">
            <Link to="/login">Back to sign in</Link>
          </p>
        </form>
      </Show>
    </main>
  );
}
