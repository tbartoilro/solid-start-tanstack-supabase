import type { AppRole } from "~/lib/auth";
import type { AuthContext } from "../context";
import { notFound } from "../errors";
import { createAdminClient } from "../supabase";

/**
 * Invitation redemption.
 *
 * Two operations with deliberately different trust models:
 *
 *   preview  — runs before the caller is authenticated at all, so it uses the
 *              admin client and returns the bare minimum.
 *   accept   — delegates entirely to public.accept_invitation(), which does the
 *              identity check and the write atomically. See the migration.
 */

export interface InvitationPreview {
  email: string;
  role: AppRole;
  organizationName: string;
}

/**
 * Describes an invitation to someone who is not yet a member — and possibly not
 * yet a user — so the accept page can say "Acme invited you as a member"
 * instead of asking them to sign in on faith.
 *
 * Uses the admin client because RLS on `invitations` requires `members.read`
 * within the organization, which the invitee provably does not have. That makes
 * this an unauthenticated read of a token-addressed row, so it returns only the
 * organization's display name, the invited address and the offered role. No
 * ids, so a token cannot be turned into a tenant identifier.
 *
 * An expired, spent or unknown token is reported identically to a missing one:
 * whether a token *used* to be valid is not the caller's business.
 */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const db = createAdminClient();

  const { data, error } = await db
    .from("invitations")
    .select("email, role, expires_at, accepted_at, organizations!inner(name)")
    .eq("token", token)
    .maybeSingle();

  if (error) throw new Error(`previewInvitation: ${error.message}`);
  if (!data || data.accepted_at !== null || new Date(data.expires_at) <= new Date()) {
    throw notFound("That invitation link is not valid any more.");
  }

  const org = data.organizations as unknown as { name: string };

  return { email: data.email, role: data.role, organizationName: org.name };
}

export interface AcceptedInvitation {
  orgId: string;
  orgSlug: string;
  role: AppRole;
}

/**
 * Redeems a token for the signed-in user.
 *
 * All of the interesting logic — that the token is live, unspent, and addressed
 * to this caller's own email — lives in the database function, because the
 * membership insert and the `accepted_at` stamp have to be one transaction. The
 * function raises a single opaque error for every rejection, which is why this
 * cannot distinguish "expired" from "wrong person" and should not try to.
 */
export async function acceptInvitation(
  ctx: AuthContext,
  token: string,
): Promise<AcceptedInvitation> {
  const { data, error } = await ctx.db.rpc("accept_invitation", { invite_token: token });

  if (error) {
    // Every rejection inside the function raises with a deliberately vague
    // message; anything else is a genuine fault worth surfacing in logs.
    if (/invitation_invalid/.test(error.message)) {
      throw notFound("That invitation link is not valid any more.");
    }
    throw new Error(`acceptInvitation: ${error.message}`);
  }

  const row = data?.[0];
  if (!row) throw notFound("That invitation link is not valid any more.");

  return { orgId: row.out_org_id, orgSlug: row.out_org_slug, role: row.out_role };
}
