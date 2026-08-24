import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, useRouter } from "@tanstack/solid-router";
import { createSignal } from "solid-js";
import { Box, Container, HStack, Stack } from "styled-system/jsx";
import { ErrorBanner, PageHeader, SuccessBanner } from "~/components/page";
import { SignOutButton } from "~/components/SignOutButton";
import { ThemeToggle } from "~/components/ThemeToggle";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { updatePassword } from "~/server/rpc/auth";
import { changeEmail, reconcileEmail, updateProfile } from "~/server/rpc/profile";

export const Route = createFileRoute("/_authed/account")({
  // Corrects the profiles-mirror drift described in services/profile.ts before
  // the page renders the address it is about to show.
  loader: () => reconcileEmail(),
  component: AccountPage,
});

function AccountPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  /*
   * An accessor, not a destructured value. `useRouteContext()` returns a
   * signal, and saving the profile invalidates the router — a value pulled out
   * once at setup would keep reporting the address the page loaded with.
   */
  const context = Route.useRouteContext();
  const session = () => context().session;

  const [fullName, setFullName] = createSignal(session().user.fullName ?? "");
  const [avatarUrl, setAvatarUrl] = createSignal(session().user.avatarUrl ?? "");
  const [profileMsg, setProfileMsg] = createSignal<string | null>(null);
  const [profileErr, setProfileErr] = createSignal<string | null>(null);
  const [profilePending, setProfilePending] = createSignal(false);

  const [email, setEmail] = createSignal(session().user.email);
  const [emailMsg, setEmailMsg] = createSignal<string | null>(null);
  const [emailErr, setEmailErr] = createSignal<string | null>(null);
  const [emailPending, setEmailPending] = createSignal(false);

  const [password, setPassword] = createSignal("");
  const [pwMsg, setPwMsg] = createSignal<string | null>(null);
  const [pwErr, setPwErr] = createSignal<string | null>(null);
  const [pwPending, setPwPending] = createSignal(false);

  async function onSaveProfile(e: SubmitEvent) {
    e.preventDefault();
    setProfileErr(null);
    setProfileMsg(null);
    setProfilePending(true);

    try {
      await updateProfile({ fullName: fullName(), avatarUrl: avatarUrl() });
      // The name is part of the session payload, so the cached copy is stale.
      queryClient.removeQueries({ queryKey: ["session"] });
      await router.invalidate();
      setProfileMsg("Profile saved.");
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : "Could not save the profile.");
    } finally {
      setProfilePending(false);
    }
  }

  async function onChangeEmail(e: SubmitEvent) {
    e.preventDefault();
    setEmailErr(null);
    setEmailMsg(null);
    setEmailPending(true);

    try {
      const { pendingEmail } = await changeEmail({ email: email() });
      setEmailMsg(`Confirm the change from the link sent to ${pendingEmail}.`);
    } catch (err) {
      setEmailErr(err instanceof Error ? err.message : "Could not change the email.");
    } finally {
      setEmailPending(false);
    }
  }

  async function onChangePassword(e: SubmitEvent) {
    e.preventDefault();
    setPwErr(null);
    setPwMsg(null);
    setPwPending(true);

    try {
      await updatePassword({ password: password() });
      setPassword("");
      setPwMsg("Password updated.");
    } catch (err) {
      setPwErr(err instanceof Error ? err.message : "Could not update the password.");
    } finally {
      setPwPending(false);
    }
  }

  return (
    <Container maxW="42rem" py={{ base: "6", md: "10" }}>
      <PageHeader
        title="Your account"
        description="Settings that follow you across every organization."
        actions={
          <HStack gap="3">
            {/* /account sits outside the $orgSlug shell, so it has no sidebar. */}
            <Link to="/select-org">Back to organizations</Link>
            <SignOutButton />
            <ThemeToggle />
          </HStack>
        }
      />

      <Stack gap="6">
        <Card.Root>
          <Card.Header>
            <Card.Title>Profile</Card.Title>
          </Card.Header>
          <Card.Body>
            <form onSubmit={onSaveProfile}>
              <Stack gap="4">
                <Field.Root required>
                  <Field.Label>Full name</Field.Label>
                  <Input
                    type="text"
                    required
                    maxLength={80}
                    value={fullName()}
                    onInput={(e) => setFullName(e.currentTarget.value)}
                  />
                </Field.Root>

                <Field.Root>
                  <Field.Label>Avatar URL</Field.Label>
                  <Input
                    type="url"
                    placeholder="https://…"
                    value={avatarUrl()}
                    onInput={(e) => setAvatarUrl(e.currentTarget.value)}
                  />
                </Field.Root>

                <ErrorBanner message={profileErr()} />
                <SuccessBanner message={profileMsg()} />

                <Box>
                  <Button type="submit" loading={profilePending()} loadingText="Saving…">
                    Save profile
                  </Button>
                </Box>
              </Stack>
            </form>
          </Card.Body>
        </Card.Root>

        <Card.Root>
          <Card.Header>
            <Card.Title>Email</Card.Title>
            <Card.Description>
              The new address has to confirm the change before it takes effect.
            </Card.Description>
          </Card.Header>
          <Card.Body>
            <form onSubmit={onChangeEmail}>
              <Stack gap="4">
                <Field.Root required>
                  <Field.Label>Email</Field.Label>
                  <Input
                    type="email"
                    autocomplete="email"
                    required
                    value={email()}
                    onInput={(e) => setEmail(e.currentTarget.value)}
                  />
                </Field.Root>

                <ErrorBanner message={emailErr()} />
                <SuccessBanner message={emailMsg()} />

                <Box>
                  <Button
                    type="submit"
                    loading={emailPending()}
                    loadingText="Sending…"
                    disabled={email() === session().user.email}
                  >
                    Change email
                  </Button>
                </Box>
              </Stack>
            </form>
          </Card.Body>
        </Card.Root>

        <Card.Root>
          <Card.Header>
            <Card.Title>Password</Card.Title>
          </Card.Header>
          <Card.Body>
            <form onSubmit={onChangePassword}>
              <Stack gap="4">
                <Field.Root required>
                  <Field.Label>New password</Field.Label>
                  <Input
                    type="password"
                    autocomplete="new-password"
                    required
                    minLength={8}
                    value={password()}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                  />
                  <Field.HelperText>At least 8 characters.</Field.HelperText>
                </Field.Root>

                <ErrorBanner message={pwErr()} />
                <SuccessBanner message={pwMsg()} />

                <Box>
                  <Button type="submit" loading={pwPending()} loadingText="Saving…">
                    Change password
                  </Button>
                </Box>
              </Stack>
            </form>
          </Card.Body>
        </Card.Root>
      </Stack>
    </Container>
  );
}
