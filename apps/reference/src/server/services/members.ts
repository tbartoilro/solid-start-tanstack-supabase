import type { AppRole } from "~/lib/auth";
import type { OrgContext } from "../context";
import { appUrl, sendEmail } from "../email";
import { applyList, type ListInput } from "@orgadmin/server";
import { membersResource } from "~/resources/members";
import { conflict, forbidden, notFound } from "../errors";

/**
 * Membership administration.
 *
 * The permission check at the RPC boundary answers "may this user manage
 * members at all". It cannot answer the questions that actually prevent
 * privilege escalation, which are relative to the actor and the target:
 *
 *   - may an admin mint a new owner?          (no)
 *   - may someone edit their own role?        (no)
 *   - may the last owner be demoted away?     (no — enforced in the database)
 *
 * Those live here, because they are business rules rather than access control.
 */

export interface MemberRow {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: AppRole;
  joinedAt: string;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: AppRole;
  expiresAt: string;
  createdAt: string;
}

export interface MemberListResult {
  members: MemberRow[];
  total: number;
  page: number;
  pageSize: number;
}

export type ListMembersInput = ListInput;

/** Higher outranks lower. Used only for the escalation guard. */
const RANK: Record<AppRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/**
 * An actor may grant any role up to and including their own, and no higher.
 * Without this an `admin` — who legitimately holds `members.manage` — could
 * create an `owner` and thereby escalate beyond their own authority.
 */
export function assertCanAssignRole(actorRole: AppRole, targetRole: AppRole): void {
  if (RANK[targetRole] > RANK[actorRole]) {
    throw forbidden(`You cannot grant the "${targetRole}" role, which outranks your own.`);
  }
}

const MEMBER_SELECT =
  "id, user_id, role, created_at, profiles!inner(id, email, full_name, avatar_url)";

function toMemberRow(row: {
  id: string;
  user_id: string;
  role: AppRole;
  created_at: string;
  profiles: unknown;
}): MemberRow {
  const profile = row.profiles as {
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  };

  return {
    membershipId: row.id,
    userId: row.user_id,
    email: profile.email,
    fullName: profile.full_name,
    avatarUrl: profile.avatar_url,
    role: row.role,
    joinedAt: row.created_at,
  };
}

export async function listMembers(
  ctx: OrgContext,
  input: ListMembersInput,
): Promise<MemberListResult> {
  const { data, error, count } = await applyList(
    ctx.db
      .from("memberships")
      .select(membersResource.select, { count: "exact" })
      .eq("org_id", ctx.orgId),
    membersResource,
    input,
  );

  if (error) throw new Error(`listMembers: ${error.message}`);

  return {
    members: (data ?? []).map(toMemberRow),
    total: count ?? 0,
    page: input.page,
    pageSize: input.pageSize,
  };
}

/**
 * The same roster, unpaginated.
 *
 * This exists for the assignee pickers, which have to offer every member of the
 * organization — handing them a page would silently make anyone past the first
 * pageSize unassignable, which looks like missing data rather than a limit.
 * Bounded by how many people are in the org, so there is nothing to page.
 */
export async function listAllMembers(ctx: OrgContext): Promise<MemberRow[]> {
  const { data, error } = await ctx.db
    .from("memberships")
    .select(MEMBER_SELECT)
    .eq("org_id", ctx.orgId)
    .order("created_at");

  if (error) throw new Error(`listAllMembers: ${error.message}`);

  return (data ?? []).map(toMemberRow);
}

export async function changeMemberRole(
  ctx: OrgContext,
  input: { membershipId: string; role: AppRole },
): Promise<void> {
  assertCanAssignRole(ctx.role, input.role);

  const { data: target, error: lookupError } = await ctx.db
    .from("memberships")
    .select("id, user_id, role")
    .eq("org_id", ctx.orgId)
    .eq("id", input.membershipId)
    .maybeSingle();

  if (lookupError) throw new Error(`changeMemberRole/lookup: ${lookupError.message}`);
  if (!target) throw notFound("That member does not exist.");

  // Editing your own role is never legitimate: demotion should be deliberate
  // and done by someone else, and promotion is escalation by definition.
  if (target.user_id === ctx.userId) {
    throw forbidden("You cannot change your own role.");
  }

  // You also cannot act on someone who already outranks you.
  assertCanAssignRole(ctx.role, target.role);

  const { data, error } = await ctx.db
    .from("memberships")
    .update({ role: input.role })
    .eq("org_id", ctx.orgId)
    .eq("id", input.membershipId)
    .select("id");

  if (error) {
    // Raised by the protect_last_owner trigger.
    if (/must retain at least one owner/i.test(error.message)) {
      throw conflict("This organization must keep at least one owner.");
    }
    throw new Error(`changeMemberRole: ${error.message}`);
  }
  if (!data?.length) throw notFound("That member does not exist.");
}

export async function removeMember(ctx: OrgContext, membershipId: string): Promise<void> {
  const { data: target, error: lookupError } = await ctx.db
    .from("memberships")
    .select("id, user_id, role")
    .eq("org_id", ctx.orgId)
    .eq("id", membershipId)
    .maybeSingle();

  if (lookupError) throw new Error(`removeMember/lookup: ${lookupError.message}`);
  if (!target) throw notFound("That member does not exist.");

  if (target.user_id !== ctx.userId) {
    assertCanAssignRole(ctx.role, target.role);
  }

  const { error } = await ctx.db
    .from("memberships")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", membershipId);

  if (error) {
    if (/must retain at least one owner/i.test(error.message)) {
      throw conflict("This organization must keep at least one owner.");
    }
    throw new Error(`removeMember: ${error.message}`);
  }
}

export async function listInvitations(ctx: OrgContext): Promise<InvitationRow[]> {
  const { data, error } = await ctx.db
    .from("invitations")
    .select("id, email, role, expires_at, created_at")
    .eq("org_id", ctx.orgId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listInvitations: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

export interface InviteResult {
  id: string;
  /**
   * The redemption link, returned to the inviter so the UI can offer a
   * copy-to-clipboard fallback when mail is not configured or bounces.
   *
   * Handing the token back to whoever created the invitation is not an
   * escalation: public.accept_invitation() will only redeem it for a caller
   * whose own email matches the invited address.
   */
  acceptUrl: string;
  emailDelivered: boolean;
}

export async function inviteMember(
  ctx: OrgContext,
  input: { email: string; role: AppRole },
): Promise<InviteResult> {
  assertCanAssignRole(ctx.role, input.role);

  const email = input.email.trim().toLowerCase();

  const { data, error } = await ctx.db
    .from("invitations")
    .insert({ org_id: ctx.orgId, email, role: input.role, invited_by: ctx.userId })
    .select("id, token")
    .single();

  if (error) {
    if (error.code === "23505") throw conflict("There is already a pending invite for that email.");
    throw new Error(`inviteMember: ${error.message}`);
  }

  const acceptUrl = appUrl(`/accept-invite?token=${data.token}`);

  // The invitation row is the source of truth; mail is a notification about it.
  // sendEmail never throws for exactly this reason — a delivery failure must not
  // roll back, or appear to roll back, an invitation that already exists.
  const delivery = await sendEmail({
    to: email,
    subject: `You have been invited to join ${ctx.orgSlug}`,
    text:
      `You have been invited to join ${ctx.orgSlug} as ${input.role}.\n\n` +
      `Open this link to accept:\n${acceptUrl}\n\n` +
      `The invitation expires in 7 days. If you were not expecting it, ignore this message.`,
  });

  return { id: data.id, acceptUrl, emailDelivered: delivery.delivered };
}

export async function revokeInvitation(ctx: OrgContext, invitationId: string): Promise<void> {
  const { error } = await ctx.db
    .from("invitations")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", invitationId);

  if (error) throw new Error(`revokeInvitation: ${error.message}`);
}
