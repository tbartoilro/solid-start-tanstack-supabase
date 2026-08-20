import { createFileRoute, Link, redirect } from "@tanstack/solid-router";
import { For } from "solid-js";

export const Route = createFileRoute("/select-org")({
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: "/login" });
  },
  component: SelectOrg,
});

function SelectOrg() {
  const { session } = Route.useRouteContext()();

  return (
    <main class="centered">
      <div class="card">
        <h1>Choose an organization</h1>
        <ul class="list">
          <For
            each={session?.orgs ?? []}
            fallback={
              <li class="muted">
                You are not a member of any organization yet. Ask an administrator for an
                invitation.
              </li>
            }
          >
            {(org) => (
              <li>
                <Link to="/$orgSlug" params={{ orgSlug: org.slug }}>
                  {org.name}
                </Link>
                <span class="role-badge">{org.role}</span>
              </li>
            )}
          </For>
        </ul>
      </div>
    </main>
  );
}
