"use server";

import { z } from "zod";
import { authorize, orgScoped } from "../guard";
import * as members from "../services/members";

const roleEnum = z.enum(["owner", "admin", "member", "viewer"]);

export async function listMembers(input: unknown) {
  const { ctx } = await authorize("members.read", orgScoped, input);
  return members.listMembers(ctx);
}

export async function listInvitations(input: unknown) {
  const { ctx } = await authorize("members.read", orgScoped, input);
  return members.listInvitations(ctx);
}

const changeRoleSchema = orgScoped.extend({
  membershipId: z.uuid(),
  role: roleEnum,
});

export async function changeMemberRole(input: unknown) {
  const { input: data, ctx } = await authorize("members.manage", changeRoleSchema, input);
  await members.changeMemberRole(ctx, data);
  return { ok: true as const };
}

const removeSchema = orgScoped.extend({ membershipId: z.uuid() });

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
  return members.inviteMember(ctx, data);
}

const revokeSchema = orgScoped.extend({ invitationId: z.uuid() });

export async function revokeInvitation(input: unknown) {
  const { input: data, ctx } = await authorize("members.manage", revokeSchema, input);
  await members.revokeInvitation(ctx, data.invitationId);
  return { ok: true as const };
}
