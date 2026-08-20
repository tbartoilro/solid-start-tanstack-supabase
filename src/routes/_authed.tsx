import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";
import type { Session } from "~/lib/auth";

/**
 * Session gate for everything beneath it.
 *
 * ⚠ This is a UX affordance, NOT security. It prevents an unauthenticated user
 * from *navigating* into the dashboard and rendering an empty shell. It does
 * nothing whatsoever to protect data: every `"use server"` function compiles to
 * an HTTP endpoint that can be called directly, with no router in the picture.
 *
 * The checks that actually hold are `authorize()` inside each RPC handler and
 * the RLS policies underneath. If this guard were deleted, the app would look
 * broken but would not leak a single row.
 */
export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ context, location }): { session: Session } => {
    if (!context.session) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
    // Re-published so descendants get a non-nullable Session.
    return { session: context.session };
  },
  component: () => <Outlet />,
});
