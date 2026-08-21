import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, notFound, Outlet, useRouter } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { SignOutButton } from "~/components/SignOutButton";
import { can, type SessionOrg } from "~/lib/auth";
import { setActiveOrg } from "~/server/rpc/auth";

/**
 * Tenant scope for everything beneath it.
 *
 * A slug the user has no membership for produces a 404 rather than a redirect
 * or a "forbidden" screen. That is deliberate: distinguishing "this org exists
 * but you may not see it" from "no such org" would let anyone enumerate the
 * customer list by trying slugs.
 */
export const Route = createFileRoute("/_authed/$orgSlug")({
  beforeLoad: ({ context, params }): { org: SessionOrg } => {
    const org = context.session.orgs.find((o) => o.slug === params.orgSlug);
    if (!org) throw notFound();
    return { org };
  },
  component: OrgLayout,
});

function OrgLayout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session, org } = Route.useRouteContext()();

  // Both handlers change what `getSession()` would return, so the cached
  // session has to be dropped before the router re-evaluates its guards
  // against it. See the note in routes/login.tsx.
  async function switchOrg(slug: string, id: string) {
    await setActiveOrg(id);
    queryClient.removeQueries({ queryKey: ["session"] });
    await router.invalidate();
    router.navigate({ to: "/$orgSlug", params: { orgSlug: slug } });
  }

  return (
    <div class="shell">
      <aside class="sidebar">
        <div class="org-switcher">
          <label class="visually-hidden" for="org-select">
            Organization
          </label>
          <select
            id="org-select"
            value={org.id}
            onChange={(e) => {
              const next = session.orgs.find((o) => o.id === e.currentTarget.value);
              if (next) void switchOrg(next.slug, next.id);
            }}
          >
            <For each={session.orgs}>
              {(o) => <option value={o.id}>{o.name}</option>}
            </For>
          </select>
          <span class="role-badge">{org.role}</span>
        </div>

        {/*
          Navigation is filtered by permission so the sidebar never offers a
          page that would immediately 403. The pages themselves still check.
        */}
        <nav>
          <Link to="/$orgSlug" params={{ orgSlug: org.slug }} activeOptions={{ exact: true }}>
            Overview
          </Link>
          <Show when={can(session, org.id, "projects.read")}>
            <Link to="/$orgSlug/projects" params={{ orgSlug: org.slug }}>
              Projects
            </Link>
          </Show>
          <Show when={can(session, org.id, "issues.read")}>
            {/*
              `search` is required by the type system, not by convention: the
              issues route declares `page` in its search schema, so a link that
              omitted it would not compile. Broken links become type errors.
            */}
            <Link to="/$orgSlug/issues" params={{ orgSlug: org.slug }} search={{ page: 1 }}>
              Issues
            </Link>
          </Show>
          <Show when={can(session, org.id, "members.read")}>
            <Link to="/$orgSlug/members" params={{ orgSlug: org.slug }}>
              Members
            </Link>
          </Show>
          <Show when={can(session, org.id, "audit.read")}>
            <Link to="/$orgSlug/audit" params={{ orgSlug: org.slug }} search={{ page: 1 }}>
              Audit log
            </Link>
          </Show>
          <Show when={can(session, org.id, "org.settings")}>
            <Link to="/$orgSlug/settings" params={{ orgSlug: org.slug }}>
              Settings
            </Link>
          </Show>
        </nav>

        <div class="user-menu">
          <div class="user-name">{session.user.fullName ?? session.user.email}</div>
          <div class="user-email">{session.user.email}</div>
          <Link to="/account">Account</Link>
          <SignOutButton class="link-button" />
        </div>
      </aside>

      <main class="content">
        <Outlet />
      </main>
    </div>
  );
}
