import { createRootRouteWithContext, Outlet } from "@tanstack/solid-router";
import { Suspense } from "solid-js";
import { Box, Stack } from "styled-system/jsx";
import { CenteredCard } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Text } from "~/components/ui/text";
import type { Session } from "~/lib/auth";
import { sessionQuery } from "~/lib/queries";
import type { RouterContext } from "~/router";

/**
 * Resolves the session once per navigation and publishes it on the router
 * context, so child routes can make redirect decisions synchronously in their
 * own `beforeLoad` instead of each fetching it again.
 *
 * Because this runs inside `routerLoad` during SSR, the session is known before
 * a single byte of HTML is produced — which is what removes the authenticated
 * "flash of logged-out UI" entirely.
 */
export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context }): Promise<{ session: Session | null }> => {
    const session = await context.queryClient.ensureQueryData(sessionQuery());
    return { session };
  },
  component: RootComponent,
  // Anything a loader or component throws lands here rather than blanking the
  // page. The message is whatever the RPC boundary judged safe to send — see
  // src/server/on-error.ts — never a raw stack.
  errorComponent: (props) => (
    <CenteredCard title="Something went wrong">
      <Stack gap="4">
        <Text color="fg.error">{props.error.message}</Text>
        <Box>
          <Button asChild={(p) => <a {...p()} href="/">Return to the dashboard</a>} />
        </Box>
      </Stack>
    </CenteredCard>
  ),
  notFoundComponent: () => (
    <CenteredCard
      title="Not found"
      description="That page does not exist, or you do not have access to it."
    >
      <Box>
        <Button asChild={(p) => <a {...p()} href="/">Go home</a>} />
      </Box>
    </CenteredCard>
  ),
});

function RootComponent() {
  return (
    <Suspense
      fallback={
        <Box minH="100dvh" display="grid" placeItems="center">
          <Spinner size="lg" />
        </Box>
      }
    >
      <Outlet />
    </Suspense>
  );
}
