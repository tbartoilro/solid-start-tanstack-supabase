import { createListCollection } from "@ark-ui/solid/select";
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { ChevronsUpDown } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Box, HStack, Stack } from "styled-system/jsx";
import { z } from "zod";
import { Can } from "~/components/Can";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { CreateBar, Pagination, ResponsiveTable } from "~/components/data";
import { EmptyState, ErrorBanner, PageHeader } from "~/components/page";
import * as Alert from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import * as Select from "~/components/ui/select";
import * as Table from "~/components/ui/table";
import { Text } from "~/components/ui/text";
import type { AppRole } from "~/lib/auth";
import { invitationsQuery, membersQuery } from "~/lib/queries";
import { membersResource, MEMBER_SORTS, type MemberSort } from "~/resources/members";
import { SortableHeader } from "~/components/SortableHeader";
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  revokeInvitation,
} from "~/server/rpc/members";

const ROLES: AppRole[] = ["owner", "admin", "member", "viewer"];

/** One collection reused by every role picker on the page. */
const roleCollection = createListCollection({
  items: ROLES.map((r) => ({ label: r, value: r })),
});

export const Route = createFileRoute("/_authed/$orgSlug/members")({
  // `.catch()` so a hand-edited `?page=banana` degrades to page 1 rather than
  // throwing at the route boundary.
  validateSearch: z.object({
    page: z.coerce.number().int().min(1).catch(1),
    sort: z.enum(MEMBER_SORTS).catch(membersResource.defaultSort.column as MemberSort),
    dir: z.enum(["asc", "desc"]).catch(membersResource.defaultSort.dir),
  }),
  // Declaring the page as a loader dep is what makes the loader re-run when it
  // changes — and only then. The invitations list is not paged, so it is
  // fetched once and simply re-read from cache on a page change.
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(membersQuery(params.orgSlug, deps)),
      context.queryClient.ensureQueryData(invitationsQuery(params.orgSlug)),
    ]);
  },
  component: MembersPage,
});

/**
 * Compact role picker, shared by the invite form and each member row.
 *
 * `width` is a prop because the two callers want opposite things: in the invite
 * form the surrounding grid decides the width, in a table cell the picker has
 * to stay narrow so the Role column does not swallow the row.
 */
function RoleSelect(props: {
  value: AppRole;
  disabled?: boolean;
  label?: string;
  width?: string;
  onChange: (role: AppRole) => void;
}) {
  return (
    <Select.Root
      size="sm"
      width={props.width ?? "9rem"}
      collection={roleCollection}
      disabled={props.disabled}
      value={[props.value]}
      onValueChange={(d) => {
        const next = d.value[0] as AppRole | undefined;
        if (next && next !== props.value) props.onChange(next);
      }}
      positioning={{ sameWidth: true }}
    >
      <Show when={props.label}>
        <Select.Label>{props.label}</Select.Label>
      </Show>
      <Select.Control>
        <Select.Trigger>
          <Select.ValueText />
          <Select.IndicatorGroup>
            <Select.Indicator>
              <ChevronsUpDown size={16} />
            </Select.Indicator>
          </Select.IndicatorGroup>
        </Select.Trigger>
      </Select.Control>
      {/*
        Portalled to <body> because this picker also lives inside a table cell:
        rendered inline the dropdown inherits that cell's text alignment and is
        clipped by the table's horizontal scroll container.
      */}
      <Portal>
        <Select.Positioner>
          <Select.Content>
            <For each={roleCollection.items}>
              {(item) => (
                <Select.Item item={item}>
                  <Select.ItemText>{item.label}</Select.ItemText>
                  <Select.ItemIndicator />
                </Select.Item>
              )}
            </For>
          </Select.Content>
        </Select.Positioner>
      </Portal>
      <Select.HiddenSelect />
    </Select.Root>
  );
}

function MembersPage() {
  const params = Route.useParams();
  /*
   * Accessors, not destructured values. `useRouteContext()` returns a signal,
   * and this component does not remount when only `$orgSlug` changes — reading
   * it once at setup would leave the permission gates and the "is this me?"
   * check answering for whichever organization happened to be open at mount.
   */
  const context = Route.useRouteContext();
  const session = () => context().session;
  const org = () => context().org;
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const members = useQuery(() => membersQuery(params().orgSlug, search()));
  const invitations = useQuery(() => invitationsQuery(params().orgSlug));

  const setSort = (next: { column: string; dir: "asc" | "desc" }) =>
    void navigate({ search: { page: 1, sort: next.column as MemberSort, dir: next.dir } });

  const totalPages = () =>
    Math.max(1, Math.ceil((members.data?.total ?? 0) / (members.data?.pageSize ?? 25)));

  const [email, setEmail] = createSignal("");
  const [inviteRole, setInviteRole] = createSignal<AppRole>("member");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

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
      <PageHeader title="Members" description="Who belongs to this organization, and as what." />

      <ErrorBanner message={error()} />

      <Can session={session()} orgId={org().id} permission="members.invite">
        <Card.Root mb="6">
          {/*
            `pt` because Park UI's card body zeroes its top padding — it
            assumes a Card.Header above supplies that side. These filter and
            create cards have no header, so without this the first control
            sits flush against the top border while the other three sides
            keep their 24px.
          */}
          <Card.Body pt="6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setPending(true);
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
                }).finally(() => setPending(false));
              }}
            >
              <CreateBar
                action={
                  <Button
                    type="submit"
                    size="sm"
                    loading={pending()}
                    width={{ base: "full", md: "auto" }}
                  >
                    Send invite
                  </Button>
                }
              >
                <Field.Root required>
                  <Field.Label>Invite by email</Field.Label>
                  <Input
                    type="email"
                    size="sm"
                    value={email()}
                    onInput={(e) => setEmail(e.currentTarget.value)}
                    placeholder="teammate@example.com"
                    required
                  />
                </Field.Root>
                <RoleSelect
                  label="Role"
                  width="full"
                  value={inviteRole()}
                  onChange={setInviteRole}
                />
              </CreateBar>
            </form>
          </Card.Body>
        </Card.Root>
      </Can>

      {/*
        Deliberately persistent rather than a toast: whoever sent the invite has
        to be able to come back and copy the link. It is dismissed only when the
        next invite is sent.
      */}
      <Show when={undelivered()}>
        {(invite) => (
          <Alert.Root mb="6" colorPalette="amber" alignItems="flex-start">
            {/*
              The alert lays its icon and content out side by side, and a track
              in that layout sizes itself to its content by default — so without
              `minW="0"` the unbreakable invite URL below would set the width of
              the whole page instead of wrapping.
            */}
            <Alert.Content minW="0">
              <Alert.Title>Invitation created, but not emailed</Alert.Title>
              <Alert.Description>
                <Stack gap="3" mt="2">
                  <Text fontSize="sm">
                    No mail provider is configured, so send this link to{" "}
                    <strong>{invite().email}</strong> yourself. It expires in 7 days and only
                    works for that address.
                  </Text>
                  <Box
                    as="code"
                    fontFamily="mono"
                    fontSize="xs"
                    bg="bg.muted"
                    p="2"
                    rounded="l2"
                    minW="0"
                    wordBreak="break-all"
                  >
                    {invite().url}
                  </Box>
                  <Box>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(invite().url)
                          .then(() => setCopied(true));
                      }}
                    >
                      {copied() ? "Copied" : "Copy link"}
                    </Button>
                  </Box>
                </Stack>
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
        )}
      </Show>

      <Card.Root mb="6">
        <Card.Body p="0">
          <ResponsiveTable>
            <Table.Root size="sm">
              <Table.Head>
                <Table.Row>
                    <For each={membersResource.columns}>
                      {(column) => (
                        <SortableHeader
                          column={column}
                          sort={() => search().sort}
                          dir={() => search().dir}
                          onSort={setSort}
                        />
                      )}
                    </For>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                <For each={members.data?.members}>
                  {(m) => (
                    <Table.Row>
                      {/*
                        The name leads the card rather than the email, even
                        though the address is the identifier the server cares
                        about: a member list is scanned by person, and the
                        address sits on the very next line anyway.
                      */}
                      <Table.Cell data-primary>{m.fullName ?? "—"}</Table.Cell>
                      {/* An address is one unbroken token, so without
                          `anywhere` its full length becomes the column's
                          min-content width and one long address widens the
                          table by several hundred pixels. */}
                      <Table.Cell data-label="Email" overflowWrap="anywhere">
                        {m.email}
                      </Table.Cell>
                      <Table.Cell data-label="Role">
                        <Can
                          session={session()}
                          orgId={org().id}
                          permission="members.manage"
                          fallback={
                            <Badge size="sm" variant="outline">
                              {m.role}
                            </Badge>
                          }
                        >
                          {/*
                            Disabled for your own row because the server refuses it
                            outright — editing your own role is escalation by
                            definition, so the UI should not imply otherwise.
                          */}
                          <RoleSelect
                            value={m.role}
                            disabled={m.userId === session().user.id}
                            onChange={(role) =>
                              void run(() =>
                                changeMemberRole({
                                  orgSlug: params().orgSlug,
                                  membershipId: m.membershipId,
                                  role,
                                }),
                              )
                            }
                          />
                        </Can>
                      </Table.Cell>
                      <Table.Cell data-actions textAlign="right">
                        <Can session={session()} orgId={org().id} permission="members.manage">
                          {/*
                            Revoking someone's access is immediate and there is
                            no undo — re-adding them means a fresh invitation
                            they have to accept. Removing yourself is worse
                            still: you lose the organization from your own
                            switcher, so that case says so explicitly.
                          */}
                          <ConfirmDialog
                            title={
                              m.userId === session().user.id
                                ? "Remove yourself from this organization?"
                                : `Remove ${m.fullName ?? m.email}?`
                            }
                            description={
                              m.userId === session().user.id ? (
                                <>
                                  You will lose access to {org().name} immediately, including
                                  this page. Getting back in needs an invitation from another
                                  owner or admin.
                                </>
                              ) : (
                                <>
                                  {m.email} loses access to {org().name} immediately. The work
                                  they created stays. Adding them back means sending a new
                                  invitation.
                                </>
                              )
                            }
                            confirmLabel="Remove member"
                            onConfirm={() =>
                              run(() =>
                                removeMember({
                                  orgSlug: params().orgSlug,
                                  membershipId: m.membershipId,
                                }),
                              )
                            }
                            trigger={(triggerProps) => (
                              <Button
                                {...triggerProps()}
                                type="button"
                                variant="ghost"
                                size="sm"
                                colorPalette="red"
                              >
                                Remove
                              </Button>
                            )}
                          />
                        </Can>
                      </Table.Cell>
                    </Table.Row>
                  )}
                </For>
              </Table.Body>
            </Table.Root>
          </ResponsiveTable>

          <Pagination
            page={search().page}
            totalPages={totalPages()}
            summary={`Page ${search().page} of ${totalPages()} · ${members.data?.total ?? 0} members`}
            onPrevious={() => navigate({ search: (p) => ({ ...p, page: p.page - 1 }) })}
            onNext={() => navigate({ search: (p) => ({ ...p, page: p.page + 1 }) })}
          />
        </Card.Body>
      </Card.Root>

      {/*
        A named region, not a bare card. It gives screen-reader users a landmark
        to jump to, and it gives any locator an unambiguous way to say "the
        invitation is listed" — an invited address also appears in the
        copy-the-link banner above, so unscoped text matching finds it twice.
      */}
      <Card.Root role="region" aria-label="Pending invitations">
        <Card.Header>
          <Card.Title>Pending invitations</Card.Title>
        </Card.Header>
        <Card.Body>
          <Show
            when={(invitations.data?.length ?? 0) > 0}
            fallback={<EmptyState title="No pending invitations" />}
          >
            <Stack gap="0" divideY="1px" divideColor="border.default">
              <For each={invitations.data}>
                {(inv) => (
                  <HStack justifyContent="space-between" gap="4" py="3">
                    {/*
                      `minW="0"` plus the wrap lets a long address fold onto a
                      second line on a phone rather than pushing Revoke off the
                      right edge of the card.
                    */}
                    <HStack gap="3" flexWrap="wrap" minW="0">
                      <Text wordBreak="break-word">{inv.email}</Text>
                      <Badge size="sm" variant="outline">
                        {inv.role}
                      </Badge>
                    </HStack>
                    <Can session={session()} orgId={org().id} permission="members.manage">
                      {/*
                        The token in the emailed link stops working the moment
                        this runs, so an invitation revoked by mistake cannot be
                        un-revoked — the invitee needs a fresh one.
                      */}
                      <ConfirmDialog
                        title={`Revoke the invitation to ${inv.email}?`}
                        description={
                          <>
                            The link already sent to {inv.email} stops working immediately.
                            Inviting them again sends a new link.
                          </>
                        }
                        confirmLabel="Revoke invitation"
                        onConfirm={() =>
                          run(() =>
                            revokeInvitation({
                              orgSlug: params().orgSlug,
                              invitationId: inv.id,
                            }),
                          )
                        }
                        trigger={(triggerProps) => (
                          <Button {...triggerProps()} type="button" variant="ghost" size="sm">
                            Revoke
                          </Button>
                        )}
                      />
                    </Can>
                  </HStack>
                )}
              </For>
            </Stack>
          </Show>
        </Card.Body>
      </Card.Root>
    </>
  );
}
