import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/solid-router";
import { createResource, createSignal, Show } from "solid-js";
import { z } from "zod";
import { acceptInvitation, previewInvitation } from "~/server/rpc/invitations";

const searchSchema = z.object({
  token: z.string().catch(""),
});

export const Route = createFileRoute("/accept-invite")({
  // The token arrives from an email link, so it is untrusted input like any
  // other search param — parsed, never cast.
  validateSearch: searchSchema,
  beforeLoad: ({ context, search }) => {
    // An invitee usually has no account yet. Send them to signup carrying the
    // token, so they come back here already signed in.
    if (!context.session) {
      throw redirect({ to: "/signup", search: { invite: search.token } });
    }
  },
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const { session } = Route.useRouteContext()();

  const [preview] = createResource(
    () => search().token,
    (token) => previewInvitation({ token }),
  );

  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  async function onAccept() {
    setError(null);
    setPending(true);

    try {
      const accepted = await acceptInvitation({ token: search().token });

      queryClient.removeQueries({ queryKey: ["session"] });
      await router.invalidate();

      await router.navigate({ to: "/$orgSlug", params: { orgSlug: accepted.orgSlug } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept the invitation.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main class="centered">
      <div class="card">
        <Show
          when={preview()}
          fallback={
            <Show when={!preview.loading} fallback={<p class="muted">Checking the invitation…</p>}>
              <h1>Invitation not valid</h1>
              <p class="muted">
                This link has expired or has already been used. Ask whoever invited you to send
                a new one.
              </p>
              <p class="hint">
                <Link to="/select-org">Back to your organizations</Link>
              </p>
            </Show>
          }
        >
          {(invite) => (
            <>
              <h1>Join {invite().organizationName}</h1>
              <p>
                You were invited as <span class="role-badge">{invite().role}</span>.
              </p>

              {/*
                The database compares the invited address against the caller's
                own before accepting, so a mismatch cannot be accepted at all.
                Saying so up front beats letting them click and fail.
              */}
              <Show when={invite().email.toLowerCase() !== session?.user.email.toLowerCase()}>
                <p class="error" role="alert">
                  This invitation was sent to <strong>{invite().email}</strong>, but you are
                  signed in as <strong>{session?.user.email}</strong>. Sign in with the invited
                  address to accept it.
                </p>
              </Show>

              <Show when={error()}>
                <p class="error" role="alert">
                  {error()}
                </p>
              </Show>

              <button
                type="button"
                disabled={
                  pending() || invite().email.toLowerCase() !== session?.user.email.toLowerCase()
                }
                onClick={onAccept}
              >
                {pending() ? "Joining…" : `Join ${invite().organizationName}`}
              </button>
            </>
          )}
        </Show>
      </div>
    </main>
  );
}
