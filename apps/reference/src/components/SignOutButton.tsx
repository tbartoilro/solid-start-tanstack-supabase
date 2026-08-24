import { useQueryClient } from "@tanstack/solid-query";
import { useRouter } from "@tanstack/solid-router";
import { Button } from "~/components/ui/button";
import { signOut } from "~/server/rpc/auth";

/**
 * Sign out, usable from anywhere.
 *
 * Extracted because it previously existed only inside the organization sidebar,
 * which meant a user belonging to no organizations had no way to sign out at
 * all: they landed on /select-org and were stuck there short of clearing
 * cookies. Exactly the state a newly invited or newly registered user is in.
 */
export function SignOutButton(props: { variant?: "ghost" | "outline" | "link"; size?: "xs" | "sm" | "md" }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  async function onSignOut() {
    await signOut();
    // Everything cached was fetched as the previous user; clearing outright is
    // the only safe option, since a stale entry would leak their data into the
    // next session on this device.
    queryClient.clear();
    await router.invalidate();
    await router.navigate({ to: "/login" });
  }

  return (
    <Button
      type="button"
      variant={props.variant ?? "link"}
      size={props.size ?? "sm"}
      onClick={() => void onSignOut()}
    >
      Sign out
    </Button>
  );
}
