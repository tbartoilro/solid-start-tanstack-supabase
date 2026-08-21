import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, useRouter } from "@tanstack/solid-router";
import { SignOutButton } from "~/components/SignOutButton";
import { createSignal, Show } from "solid-js";
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
  const { session } = Route.useRouteContext()();

  const [fullName, setFullName] = createSignal(session.user.fullName ?? "");
  const [avatarUrl, setAvatarUrl] = createSignal(session.user.avatarUrl ?? "");
  const [profileMsg, setProfileMsg] = createSignal<string | null>(null);
  const [profileErr, setProfileErr] = createSignal<string | null>(null);
  const [profilePending, setProfilePending] = createSignal(false);

  const [email, setEmail] = createSignal(session.user.email);
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
    <>
      <div class="page-header">
        <h1>Your account</h1>
        {/* /account sits outside the $orgSlug shell, so it has no sidebar. */}
        <Link to="/select-org">Back to organizations</Link> &middot;{" "}
        <SignOutButton class="link-button" />
      </div>

      <section class="card">
        <h2>Profile</h2>
        <form class="auth-form" onSubmit={onSaveProfile}>
          <label>
            Full name
            <input
              type="text"
              required
              maxLength={80}
              value={fullName()}
              onInput={(e) => setFullName(e.currentTarget.value)}
            />
          </label>

          <label>
            Avatar URL
            <input
              type="url"
              placeholder="https://…"
              value={avatarUrl()}
              onInput={(e) => setAvatarUrl(e.currentTarget.value)}
            />
          </label>

          <Show when={profileErr()}>
            <p class="error" role="alert">
              {profileErr()}
            </p>
          </Show>
          <Show when={profileMsg()}>
            <p class="success" role="status">
              {profileMsg()}
            </p>
          </Show>

          <button type="submit" disabled={profilePending()}>
            {profilePending() ? "Saving…" : "Save profile"}
          </button>
        </form>
      </section>

      <section class="card">
        <h2>Email</h2>
        <form class="auth-form" onSubmit={onChangeEmail}>
          <label>
            Email
            <input
              type="email"
              autocomplete="email"
              required
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
            />
          </label>

          <Show when={emailErr()}>
            <p class="error" role="alert">
              {emailErr()}
            </p>
          </Show>
          <Show when={emailMsg()}>
            <p class="success" role="status">
              {emailMsg()}
            </p>
          </Show>

          <button type="submit" disabled={emailPending() || email() === session.user.email}>
            {emailPending() ? "Sending…" : "Change email"}
          </button>

          <p class="hint">
            The new address has to confirm the change before it takes effect.
          </p>
        </form>
      </section>

      <section class="card">
        <h2>Password</h2>
        <form class="auth-form" onSubmit={onChangePassword}>
          <label>
            New password
            <input
              type="password"
              autocomplete="new-password"
              required
              minLength={8}
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </label>

          <Show when={pwErr()}>
            <p class="error" role="alert">
              {pwErr()}
            </p>
          </Show>
          <Show when={pwMsg()}>
            <p class="success" role="status">
              {pwMsg()}
            </p>
          </Show>

          <button type="submit" disabled={pwPending()}>
            {pwPending() ? "Saving…" : "Change password"}
          </button>
        </form>
      </section>
    </>
  );
}
