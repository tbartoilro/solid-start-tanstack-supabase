import { createFileRoute, Link, redirect } from "@tanstack/solid-router";
import { For } from "solid-js";
import { HStack, Stack } from "styled-system/jsx";
import { CenteredCard } from "~/components/page";
import { SignOutButton } from "~/components/SignOutButton";
import { Badge } from "~/components/ui/badge";
import { Text } from "~/components/ui/text";

export const Route = createFileRoute("/select-org")({
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: "/login" });
  },
  component: SelectOrg,
});

function SelectOrg() {
  /*
   * An accessor, not a destructured value. `useRouteContext()` returns a
   * signal, so reading it once during setup pins the list to whatever
   * organizations the session carried at mount — a membership gained or lost
   * afterwards would never show up here.
   */
  const context = Route.useRouteContext();
  const session = () => context().session;

  return (
    <CenteredCard title="Choose an organization">
      <Stack gap="5">
        <Stack gap="0" divideY="1px" divideColor="border.default">
          <For
            each={session()?.orgs ?? []}
            fallback={
              <Text color="fg.muted" py="2">
                You are not a member of any organization yet.
              </Text>
            }
          >
            {(org) => (
              <HStack justifyContent="space-between" gap="4" py="3">
                <Link to="/$orgSlug" params={{ orgSlug: org.slug }}>
                  {org.name}
                </Link>
                <Badge size="sm" variant="outline">
                  {org.role}
                </Badge>
              </HStack>
            )}
          </For>
        </Stack>

        <Text fontSize="sm" color="fg.muted">
          Starting something new? <Link to="/new-org">Create an organization</Link>.
        </Text>

        <HStack
          gap="3"
          fontSize="sm"
          pt="4"
          borderTopWidth="1px"
          borderColor="border.default"
        >
          <Link to="/account">Your account</Link>
          <SignOutButton />
        </HStack>
      </Stack>
    </CenteredCard>
  );
}
