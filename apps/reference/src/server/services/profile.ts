import type { AuthContext } from "../context";
import { notFound } from "../errors";

/**
 * The caller's own profile.
 *
 * Not tenant-scoped: a profile belongs to a user, not to an organization, so
 * these run under `authenticated()` rather than `authorize()`. The "profiles:
 * update own" RLS policy is what actually confines a write to the caller's own
 * row — the `.eq("id", ctx.userId)` below is belt-and-braces, not the guarantee.
 */

export interface ProfileUpdate {
  fullName: string;
  avatarUrl: string | null;
}

export async function updateProfile(
  ctx: AuthContext,
  input: ProfileUpdate,
): Promise<{ fullName: string; avatarUrl: string | null }> {
  const { data, error } = await ctx.db
    .from("profiles")
    .update({ full_name: input.fullName, avatar_url: input.avatarUrl })
    .eq("id", ctx.userId)
    .select("full_name, avatar_url")
    .single();

  if (error) throw new Error(`updateProfile: ${error.message}`);
  if (!data) throw notFound();

  return { fullName: data.full_name ?? input.fullName, avatarUrl: data.avatar_url };
}

/**
 * Keeps `profiles.email` in step with an address change made in GoTrue.
 *
 * `profiles` is populated by the on_auth_user_created trigger, which fires only
 * on insert — so without this the mirror silently drifts after an email change,
 * and every screen that renders an address from `profiles` shows the old one.
 *
 * Note that `public.accept_invitation` deliberately reads auth.users instead of
 * this column, precisely because the mirror can lag.
 */
export async function syncProfileEmail(ctx: AuthContext, email: string): Promise<void> {
  const { error } = await ctx.db.from("profiles").update({ email }).eq("id", ctx.userId);

  if (error) throw new Error(`syncProfileEmail: ${error.message}`);
}
