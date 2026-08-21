import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { createSignal, For, Show } from "solid-js";
import { Can } from "~/components/Can";
import type { AppRole } from "~/lib/auth";
import { invitationsQuery, membersQuery } from "~/lib/queries";
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  revokeInvitation,
} from "~/server/rpc/members";

const ROLES: AppRole[] = ["owner", "admin", "member", "viewer"];

export const Route = createFileRoute("/_authed/$orgSlug/members")({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(membersQuery(params.orgSlug)),
      context.queryClient.ensureQueryData(invitationsQuery(params.orgSlug)),
    ]);
  },
  component: MembersPage,
});

function MembersPage() {
  const params = Route.useParams();
  const { session, org } = Route.useRouteContext()();
  const queryClient = useQueryClient();

  const members = useQuery(() => membersQuery(params().orgSlug));
  const invitations = useQuery(() => invitationsQuery(params().orgSlug));

  const [email, setEmail] = createSignal("");
  const [inviteRole, setInviteRole] = createSignal<AppRole>("member");
  const [error, setError] = createSignal<string | null>(null);

  /**
   * Set when an invite was created but its email could not be sent — which is
   * the normal case in local development, where no RESEND_API_KEY is
   * configured. The invitation itself is committed either way, so the link has
   * to be reachable from somewhere other than the server log.
   */
  const [undelivered, setUndelivered] = createSignal<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = createSignal(false);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["members", params().orgSlug] }),
      queryClient.invalidateQueries({ queryKey: ["invitations", params().orgSlug] }),
    ]);
  }

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    }
  }

  return (
    <>
      <header class="page-header">
        <h1>Members</h1>
      </header>

      <Show when={error()}>
        <p class="error" role="alert">
          {error()}
        </p>
      </Show>

      <Can session={session} orgId={org.id} permission="members.invite">
        <form
          class="card inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const invited = email();
              const result = await inviteMember({
                orgSlug: params().orgSlug,
                email: invited,
                role: inviteRole(),
              });
              setCopied(false);
              setUndelivered(
                result.emailDelivered ? null : { email: invited, url: result.acceptUrl },
              );
              setEmail("");
            });
          }}
        >
          <label>
            Invite by email
            <input
              type="email"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              required
            />
          </label>
          <label>
            Role
            <select
              value={inviteRole()}
              onChange={(e) => setInviteRole(e.currentTarget.value as AppRole)}
            >
              <For each={ROLES}>{(r) => <option value={r}>{r}</option>}</For>
            </select>
          </label>
          <button type="submit">Send invite</button>
        </form>
      </Can>

      {/*
        Deliberately persistent rather than a toast: whoever sent the invite has
        to be able to come back and copy the link. It is dismissed only when the
        next invite is sent.
      */}
      <Show when={undelivered()}>
        {(pending) => (
          <section class="card">
            <h2>Invitation created, but not emailed</h2>
            <p class="muted">
              No mail provider is configured, so send this link to{" "}
              <strong>{pending().email}</strong> yourself. It expires in 7 days and only works
              for that address.
            </p>
            <p>
              <code class="key">{pending().url}</code>
            </p>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(pending().url).then(() => setCopied(true));
              }}
            >
              {copied() ? "Copied" : "Copy link"}
            </button>
          </section>
        )}
      </Show>

      <section class="card">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For each={members.data}>
              {(m) => (
                <tr>
                  <td>{m.fullName ?? "—"}</td>
                  <td>{m.email}</td>
                  <td>
                    <Can
                      session={session}
                      orgId={org.id}
                      permission="members.manage"
                      fallback={<span class="role-badge">{m.role}</span>}
                    >
                      {/*
                        Disabled for your own row because the server refuses it
                        outright — editing your own role is escalation by
                        definition, so the UI should not imply otherwise.
                      */}
                      <select
                        value={m.role}
                        disabled={m.userId === session.user.id}
                        onChange={(e) =>
                          void run(() =>
                            changeMemberRole({
                              orgSlug: params().orgSlug,
                              membershipId: m.membershipId,
                              role: e.currentTarget.value as AppRole,
                            }),
                          )
                        }
                      >
                        <For each={ROLES}>{(r) => <option value={r}>{r}</option>}</For>
                      </select>
                    </Can>
                  </td>
                  <td class="row-actions">
                    <Can session={session} orgId={org.id} permission="members.manage">
                      <button
                        type="button"
                        class="danger"
                        onClick={() =>
                          void run(() =>
                            removeMember({
                              orgSlug: params().orgSlug,
                              membershipId: m.membershipId,
                            }),
                          )
                        }
                      >
                        Remove
                      </button>
                    </Can>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </section>

      <Show when={(invitations.data?.length ?? 0) > 0}>
        <section class="card">
          <h2>Pending invitations</h2>
          <ul class="list">
            <For each={invitations.data}>
              {(inv) => (
                <li>
                  <span>
                    {inv.email} · <span class="role-badge">{inv.role}</span>
                  </span>
                  <Can session={session} orgId={org.id} permission="members.manage">
                    <button
                      type="button"
                      class="link-button"
                      onClick={() =>
                        void run(() =>
                          revokeInvitation({
                            orgSlug: params().orgSlug,
                            invitationId: inv.id,
                          }),
                        )
                      }
                    >
                      Revoke
                    </button>
                  </Can>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </>
  );
}
