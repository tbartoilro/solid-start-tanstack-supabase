"use server";

import { getRequestEvent } from "solid-js/web";
import { z } from "zod";
import { conflict } from "../errors";
import { authenticated } from "../guard";
import { enforceRateLimit } from "../rate-limit";
import * as profile from "../services/profile";

/** The caller's own account. Nothing here is tenant-scoped. */

function event() {
  const e = getRequestEvent();
  if (!e) throw new Error("No request event.");
  return e;
}

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1, "Tell us your name.").max(80),
  // Empty string clears the avatar rather than storing "".
  avatarUrl: z.union([z.url(), z.literal("")]).optional(),
});

export async function updateProfile(input: unknown) {
  const { input: data, ctx } = await authenticated(updateProfileSchema, input);

  return profile.updateProfile(ctx, {
    fullName: data.fullName,
    avatarUrl: data.avatarUrl ? data.avatarUrl : null,
  });
}

const changeEmailSchema = z.object({
  email: z.email("Enter a valid email address."),
});

/**
 * Starts an email change.
 *
 * GoTrue sends a confirmation to the *new* address and only swaps it once that
 * link is followed, so this cannot be used to take over an address. The
 * `profiles` mirror is therefore NOT updated here — it is updated on the next
 * request after the change lands, via syncProfileEmail below.
 */
export async function changeEmail(input: unknown) {
  const { input: data, ctx } = await authenticated(changeEmailSchema, input);

  enforceRateLimit({ name: "change-email", subject: ctx.userId, limit: 5, windowMs: 60 * 60_000 });

  const { error } = await event().locals.supabase.auth.updateUser({ email: data.email });

  if (error) throw conflict(error.message);

  return { ok: true as const, pendingEmail: data.email };
}

/**
 * Reconciles the profiles mirror with the authoritative address in GoTrue.
 *
 * Called by the account page on load: cheap, idempotent, and the only place the
 * drift described in services/profile.ts can be noticed and corrected.
 */
export async function reconcileEmail() {
  const { ctx } = await authenticated(z.object({}), {});

  const authEmail = event().locals.auth?.email;
  if (!authEmail) return { ok: true as const, changed: false };

  const { data } = await ctx.db.from("profiles").select("email").eq("id", ctx.userId).single();

  if (data && data.email !== authEmail) {
    await profile.syncProfileEmail(ctx, authEmail);
    return { ok: true as const, changed: true };
  }

  return { ok: true as const, changed: false };
}
