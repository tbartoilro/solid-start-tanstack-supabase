import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, notFound, Outlet, useRouter } from "@tanstack/solid-router";
import { ChevronsUpDown, Check } from "lucide-solid";
import { For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { css } from "styled-system/css";
import { Box, Grid, HStack, Stack } from "styled-system/jsx";
import { SignOutButton } from "~/components/SignOutButton";
import { ThemeToggle } from "~/components/ThemeToggle";
import * as Avatar from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import * as Menu from "~/components/ui/menu";
import { Text } from "~/components/ui/text";
import { can, type SessionOrg } from "~/lib/auth";
import { setActiveOrg } from "~/server/rpc/auth";
import { AUDIT_DEFAULT_SEARCH } from "~/resources/audit";

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

/**
 * Sidebar link styling.
 *
 * TanStack Router puts `.active` on the matching link, so the selected state is
 * driven by the router rather than by comparing paths by hand.
 */
const navLink = css({
  display: "block",
  px: "3",
  py: "2",
  rounded: "l2",
  fontSize: "sm",
  fontWeight: "medium",
  color: "fg.muted",
  textDecoration: "none",
  transition: "background 0.15s, color 0.15s",
  // The nav is a horizontal scroller below `md`; without these the links
  // compress into unreadable slivers instead of overflowing.
  whiteSpace: "nowrap",
  flexShrink: 0,
  _hover: { bg: "bg.muted", color: "fg.default" },
  "&.active": { bg: "colorPalette.a3", color: "colorPalette.text" },
});

/**
 * Secondary links in the account row, sized down so the row fits a phone
 * alongside the avatar, sign-out and theme controls.
 */
const accountLink = css({
  px: "2",
  py: "1",
  rounded: "l2",
  fontSize: "sm",
  color: "fg.muted",
  textDecoration: "none",
  whiteSpace: "nowrap",
  _hover: { bg: "bg.muted", color: "fg.default" },
});

function OrgLayout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  /*
   * Accessors, not destructured values.
   *
   * `useRouteContext()` returns a signal. Calling it once during setup and
   * pulling `org` out of the result snapshots whatever was current at mount —
   * and this layout does NOT remount when only the `$orgSlug` param changes, so
   * switching organizations left every reader here pinned to the previous one:
   * the switcher kept the old name, the nav links kept building `/old-slug/...`
   * so any page you clicked showed the wrong tenant's data, and the guard in
   * `onSelect` compared against the stale id, which made selecting the org you
   * had actually come from a no-op you could not escape.
   */
  const context = Route.useRouteContext();
  const session = () => context().session;
  const org = () => context().org;

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
    <Grid
      /*
       * `minmax(0, 1fr)` rather than `1fr`. A `1fr` track carries an implicit
       * `min-width: auto`, so any child wider than the viewport — a data table,
       * here — widens the track instead of scrolling inside it, and the whole
       * document ends up scrolling sideways on a phone.
       */
      gridTemplateColumns={{ base: "minmax(0, 1fr)", md: "16rem minmax(0, 1fr)" }}
      /*
       * Give the slack to the content row. Grid defaults to
       * `align-content: stretch`, which was splitting the leftover 100dvh
       * between the two rows and leaving the sidebar 170px of dead space below
       * its content on mobile.
       */
      gridTemplateRows={{ base: "auto 1fr", md: "1fr" }}
      minH="100dvh"
      gap="0"
      alignItems="stretch"
    >
      {/*
        One element, two layouts. Below `md` this is a sticky top bar; from `md`
        it is the left column. Rendering separate mobile and desktop versions
        would put two <nav>s and two "Sign out" buttons in the DOM, which breaks
        both the accessibility tree and Playwright's strict-mode locators.
      */}
      <Stack
        as="aside"
        borderRightWidth={{ md: "1px" }}
        borderBottomWidth={{ base: "1px", md: "0" }}
        borderColor="border.default"
        bg="bg.subtle"
        p={{ base: "3", md: "4" }}
        gap={{ base: "3", md: "6" }}
        position={{ base: "sticky", md: "static" }}
        top="0"
        zIndex="docked"
      >
        <Menu.Root onSelect={(d) => {
          const next = session().orgs.find((o) => o.id === d.value);
          if (next && next.id !== org().id) void switchOrg(next.slug, next.id);
        }}>
          <Menu.Trigger asChild={(triggerProps) => (
            <Button {...triggerProps()} variant="outline" width="full" justifyContent="space-between">
              <Stack gap="0" alignItems="flex-start" textAlign="left">
                <Text fontWeight="semibold" fontSize="sm" lineHeight="1.2">
                  {org().name}
                </Text>
                <Text color="fg.muted" fontSize="xs" lineHeight="1.2">
                  {org().role}
                </Text>
              </Stack>
              <ChevronsUpDown size={16} />
            </Button>
          )} />
          {/*
            Portalled for the same reason as the confirm dialog: the sidebar is
            a sticky, scrollable bar on mobile, and an inline popover would be
            clipped by it.
          */}
          <Portal>
            <Menu.Positioner>
            <Menu.Content minW="14rem">
              <Menu.ItemGroup>
                <Menu.ItemGroupLabel>Organizations</Menu.ItemGroupLabel>
                <For each={session().orgs}>
                  {(o) => (
                    <Menu.Item value={o.id}>
                      <HStack justifyContent="space-between" width="full" gap="3">
                        <span>{o.name}</span>
                        <Show when={o.id === org().id}>
                          <Check size={14} />
                        </Show>
                      </HStack>
                    </Menu.Item>
                  )}
                </For>
              </Menu.ItemGroup>
              <Menu.Separator />
              <Menu.Item value="__new" asChild={(itemProps) => (
                <Link {...itemProps()} to="/new-org">
                  Create an organization
                </Link>
              )} />
            </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>

        {/*
          Navigation is filtered by permission so the sidebar never offers a
          page that would immediately 403. The pages themselves still check.
        */}
        <Stack
          as="nav"
          direction={{ base: "row", md: "column" }}
          gap={{ base: "1", md: "0.5" }}
          overflowX={{ base: "auto", md: "visible" }}
          // Edge-to-edge scroll on a phone so the last item is not clipped by
          // the bar's own padding.
          mx={{ base: "-3", md: "0" }}
          px={{ base: "3", md: "0" }}
          css={{ "&::-webkit-scrollbar": { display: "none" }, scrollbarWidth: "none" }}
        >
          <Link to="/$orgSlug" params={{ orgSlug: org().slug }} activeOptions={{ exact: true }} class={navLink}>
            Overview
          </Link>
          <Show when={can(session(), org().id, "projects.read")}>
            <Link to="/$orgSlug/projects" params={{ orgSlug: org().slug }} search={{ page: 1 }} class={navLink}>
              Projects
            </Link>
          </Show>
          <Show when={can(session(), org().id, "issues.read")}>
            {/*
              `search` is required by the type system, not by convention: the
              issues route declares `page` in its search schema, so a link that
              omitted it would not compile. Broken links become type errors.
            */}
            <Link to="/$orgSlug/issues" params={{ orgSlug: org().slug }} search={{ page: 1 }} class={navLink}>
              Issues
            </Link>
          </Show>
          <Show when={can(session(), org().id, "members.read")}>
            <Link to="/$orgSlug/members" params={{ orgSlug: org().slug }} search={{ page: 1 }} class={navLink}>
              Members
            </Link>
          </Show>
          <Show when={can(session(), org().id, "audit.read")}>
            <Link to="/$orgSlug/audit" params={{ orgSlug: org().slug }} search={AUDIT_DEFAULT_SEARCH} class={navLink}>
              Audit log
            </Link>
          </Show>
          <Show when={can(session(), org().id, "org.settings")}>
            <Link to="/$orgSlug/settings" params={{ orgSlug: org().slug }} class={navLink}>
              Settings
            </Link>
          </Show>
        </Stack>

        <Stack
          gap="2"
          mt={{ md: "auto" }}
          pt={{ base: "0", md: "4" }}
          borderTopWidth={{ base: "0", md: "1px" }}
          borderColor="border.default"
          direction={{ base: "row", md: "column" }}
          alignItems={{ base: "center", md: "stretch" }}
          justifyContent="space-between"
        >
          <HStack gap="2" minW="0">
            <Avatar.Root size="xs">
              {/* Falls back to initials, then to a generic icon. */}
              <Avatar.Image
                src={session().user.avatarUrl ?? undefined}
                alt={session().user.fullName ?? session().user.email}
              />
              <Avatar.Fallback name={session().user.fullName ?? session().user.email} />
            </Avatar.Root>
            {/*
              Only the text hides on a phone. Hiding an interactive element and
              rendering a duplicate elsewhere is what produces two "Sign out"
              buttons in the tree.
            */}
            <Box minW="0" hideBelow="sm">
              <Text fontSize="sm" fontWeight="medium" truncate>
                {session().user.fullName ?? session().user.email}
              </Text>
              <Text fontSize="xs" color="fg.muted" truncate>
                {session().user.email}
              </Text>
            </Box>
            <Badge size="sm" variant="outline" hideBelow="md">
              {org().role}
            </Badge>
          </HStack>

          <HStack gap="1" flexShrink={0} flexWrap="wrap" justifyContent="flex-end">
            <Link to="/account" class={accountLink}>
              Account
            </Link>
            <SignOutButton />
            <ThemeToggle />
          </HStack>
        </Stack>
      </Stack>

      <Box as="main" p={{ base: "4", md: "8" }} maxW="72rem" width="full" minW="0">
        <Outlet />
      </Box>
    </Grid>
  );
}
