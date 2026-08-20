import { createFileRoute, redirect } from "@tanstack/solid-router";

/**
 * The root path is a router, not a page: send people wherever they actually
 * belong. Doing it in `beforeLoad` means the redirect is issued during SSR, so
 * the browser never renders an intermediate screen.
 */
export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => {
    const session = context.session;

    if (!session) throw redirect({ to: "/login" });

    const active =
      session.orgs.find((o) => o.id === session.activeOrgId) ?? session.orgs[0];

    if (!active) throw redirect({ to: "/select-org" });

    throw redirect({ to: "/$orgSlug", params: { orgSlug: active.slug } });
  },
});
