import { getRequestEvent } from "solid-js/web";
import { log } from "./log";

/**
 * Forces a new access token so the `orgs` claim reflects a membership change.
 *
 * `custom_access_token_hook` stamps memberships into the JWT when the token is
 * minted, which makes the claim a cache — and immediately after creating an
 * organization or accepting an invitation, that cache is provably stale: the
 * membership row exists but the caller's token predates it.
 *
 * That matters because `requireOrg` resolves the tenant from the claim, so
 * without this the user would be bounced with "not found" from the very
 * organization they just joined. Refreshing here re-runs the hook and writes
 * the new tokens back as cookies through the request client's cookie adapter.
 *
 * A failure is logged rather than thrown: the membership itself is already
 * committed, so the correct outcome is a stale-but-recoverable session (the
 * next natural token refresh fixes it) rather than an error that implies the
 * write did not happen.
 */
export async function refreshClaims(): Promise<void> {
  const event = getRequestEvent();
  if (!event) throw new Error("No request event.");

  const { error } = await event.locals.supabase.auth.refreshSession();

  if (error) {
    log.warn("refreshClaims failed; session will carry a stale orgs claim", {
      requestId: event.locals.requestId,
      error: error.message,
    });
  }
}
