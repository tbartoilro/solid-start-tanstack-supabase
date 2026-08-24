"use server";

import { z } from "zod";
import { authorize, orgScoped } from "../guard";
import { enforceRateLimit } from "../rate-limit";
import * as members from "../services/members";

const roleEnum = z.enum(["owner", "admin", "member", "viewer"]);

/**
 * Pagination is clamped server-side, because the endpoint is public and a
 * limit the UI happens to respect is not a limit. `.catch` rather than a hard
 * rejection: anything out of range (`pageSize=100000`, `page=0`, `page=abc`)
 * falls back to the default instead of erroring, so a mangled URL still
 * renders a page.
 */
const listSchema = orgScoped.extend({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25),
});

export async function listMembers(input: unknown) {
  const { input: data, ctx } = await authorize("members.read", listSchema, input);
  return members.listMembers(ctx, data);
}

/**
 * The unpaginated roster, for pickers that must offer every member.
 *
 * Separate endpoint rather than a `pageSize=all` escape hatch on the one above,
 * so the paged endpoint keeps a ceiling that cannot be argued away by input.
 * Same `members.read` permission: this exposes nothing the paged call does not,
 * only in one response.
 */
export async function listAllMembers(input: unknown) {
  const { ctx } = await authorize("members.read", orgScoped, input);
  return members.listAllMembers(ctx);
}

export async function listInvitations(input: unknown) {
  const { ctx } = await authorize("members.read", orgScoped, input);
  return members.listInvitations(ctx);
}

const changeRoleSchema = orgScoped.extend({
  membershipId: z.guid(),
  role: roleEnum,
});

export async function changeMemberRole(input: unknown) {
  const { input: data, ctx } = await authorize("members.manage", changeRoleSchema, input);
  await members.changeMemberRole(ctx, data);
  return { ok: true as const };
}

const removeSchema = orgScoped.extend({ membershipId: z.guid() });

export async function removeMember(input: unknown) {
  const { input: data, ctx } = await authorize("members.manage", removeSchema, input);
  await members.removeMember(ctx, data.membershipId);
  return { ok: true as const };
}

const inviteSchema = orgScoped.extend({
  email: z.email("Enter a valid email address."),
  role: roleEnum,
});

export async function inviteMember(input: unknown) {
  const { input: data, ctx } = await authorize("members.invite", inviteSchema, input);

  // Invites send mail to arbitrary addresses on the organization's behalf, so an
  // account with members.invite is a spam relay if left unthrottled. Scoped per
  // organization rather than per address: the limit should follow the tenant,
  // not the network path the request happened to take.
  enforceRateLimit({ name: "invite", subject: ctx.orgId, limit: 20, windowMs: 60 * 60_000 });

  return members.inviteMember(ctx, data);
}

const revokeSchema = orgScoped.extend({ invitationId: z.guid() });

export async function revokeInvitation(input: unknown) {
  const { input: data, ctx } = await authorize("members.manage", revokeSchema, input);
  await members.revokeInvitation(ctx, data.invitationId);
  return { ok: true as const };
}
