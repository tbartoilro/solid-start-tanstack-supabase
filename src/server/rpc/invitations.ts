"use server";

import { z } from "zod";
import { isAppError } from "../errors";
import { authenticated } from "../guard";
import { log } from "../log";
import { enforceRateLimit } from "../rate-limit";
import { refreshClaims } from "../refresh-claims";
import * as invitations from "../services/invitations";

/**
 * Invitation redemption endpoints.
 *
 * Neither of these can use `authorize`: the caller is by definition not yet a
 * member of the organization in question. `preview` is reachable without any
 * session at all, which is the point — the invitee needs to see what they are
 * being asked to join before creating an account.
 */

const tokenSchema = z.object({
  // 32 random bytes, hex-encoded by the schema default.
  token: z.string().regex(/^[a-f0-9]{64}$/, "That invitation link is not valid."),
});

/**
 * Unauthenticated. Rate-limited per token because this is the one endpoint that
 * will confirm a token exists, and it is reachable by anyone: without a limit it
 * is a free oracle for brute-forcing the token space.
 */
export async function previewInvitation(input: unknown) {
  const parsed = tokenSchema.safeParse(input);
  // A malformed token is indistinguishable from an unknown one, on purpose.
  if (!parsed.success) {
    return null;
  }

  enforceRateLimit({
    name: "invite-preview",
    subject: parsed.data.token,
    limit: 10,
    windowMs: 60_000,
  });

  try {
    return await invitations.previewInvitation(parsed.data.token);
  } catch (error) {
    // A token that is unknown, spent or expired is a null result, not an
    // incident — previewInvitation raises not_found for all three, and telling
    // them apart would make this an oracle.
    if (isAppError(error) && error.code === "not_found") return null;

    // Anything else is infrastructure: a bad service key, an unreachable
    // database. Swallowing those made a misconfiguration indistinguishable from
    // an expired link, and cost a CI debugging cycle proving exactly that.
    log.error("previewInvitation failed for a reason unrelated to the token", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function acceptInvitation(input: unknown) {
  const { input: data, ctx } = await authenticated(tokenSchema, input);

  enforceRateLimit({ name: "invite-accept", subject: ctx.userId, limit: 20, windowMs: 60 * 60_000 });

  const accepted = await invitations.acceptInvitation(ctx, data.token);

  // The membership exists now, but the caller's token predates it.
  await refreshClaims();

  return accepted;
}
