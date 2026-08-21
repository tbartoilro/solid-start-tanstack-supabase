import { createFileRoute, Link, redirect } from "@tanstack/solid-router";
import { For } from "solid-js";
import { SignOutButton } from "~/components/SignOutButton";

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
                You are not a member of any organization yet.
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

        <p class="hint">
          Starting something new? <Link to="/new-org">Create an organization</Link>.
        </p>

        <p class="hint">
          <Link to="/account">Your account</Link> &middot;{" "}
          <SignOutButton class="link-button" />
        </p>
      </div>
    </main>
  );
}
