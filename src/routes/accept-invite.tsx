import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/solid-router";
import { createResource, createSignal, Show } from "solid-js";
import { HStack, Stack } from "styled-system/jsx";
import { z } from "zod";
import { CenteredCard, ErrorBanner } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Text } from "~/components/ui/text";
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
  /*
   * An accessor, not a destructured value. `useRouteContext()` returns a
   * signal, so pulling `session` out of one call freezes the signed-in address
   * at mount — and the address comparison below decides whether the Join
   * button is usable at all.
   */
  const context = Route.useRouteContext();
  const session = () => context().session;

  const [preview] = createResource(
    () => search().token,
    (token) => previewInvitation({ token }),
  );

  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  /** The database enforces this too; checking here just avoids a doomed click. */
  const addressMismatch = () => {
    const invite = preview();
    if (!invite) return false;
    return invite.email.toLowerCase() !== session()?.user.email.toLowerCase();
  };

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
    <Show
      when={preview()}
      fallback={
        <Show
          when={!preview.loading}
          fallback={
            <CenteredCard title="Checking the invitation…">
              <HStack gap="3">
                <Spinner size="sm" />
                <Text color="fg.muted">One moment.</Text>
              </HStack>
            </CenteredCard>
          }
        >
          <CenteredCard
            title="Invitation not valid"
            description="This link has expired or has already been used. Ask whoever invited you to send a new one."
          >
            <Text fontSize="sm">
              <Link to="/select-org">Back to your organizations</Link>
            </Text>
          </CenteredCard>
        </Show>
      }
    >
      {(invite) => (
        <CenteredCard title={`Join ${invite().organizationName}`}>
          <Stack gap="4">
            <HStack gap="2">
              <Text>You were invited as</Text>
              <Badge size="sm">{invite().role}</Badge>
            </HStack>

            {/*
              The database compares the invited address against the caller's
              own before accepting, so a mismatch cannot be accepted at all.
              Saying so up front beats letting them click and fail.
            */}
            <Show when={addressMismatch()}>
              <ErrorBanner
                message={`This invitation was sent to ${invite().email}, but you are signed in as ${session()?.user.email}. Sign in with the invited address to accept it.`}
              />
            </Show>

            <ErrorBanner message={error()} />

            <Button
              type="button"
              loading={pending()}
              loadingText="Joining…"
              disabled={addressMismatch()}
              onClick={onAccept}
              width="full"
            >
              Join {invite().organizationName}
            </Button>
          </Stack>
        </CenteredCard>
      )}
    </Show>
  );
}
