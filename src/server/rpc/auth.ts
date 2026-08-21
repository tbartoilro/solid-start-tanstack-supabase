"use server";

import { setCookie } from "@solidjs/start/http";
import { getRequestEvent } from "solid-js/web";
import { z } from "zod";
import type { AppPermission, AppRole, Session, SessionOrg } from "~/lib/auth";
import { isProduction } from "~/lib/env";
import { requireAuth } from "~/server/context";
import { appUrl } from "~/server/email";
import { conflict, invalidInput, unauthenticated } from "~/server/errors";
import { ACTIVE_ORG_COOKIE, baseCookieOptions } from "~/server/cookies";
import { log } from "~/server/log";
import { enforceRateLimit } from "~/server/rate-limit";

/**
 * Authentication RPC.
 *
 * Every export in this module is a server function: `"use server"` at module
 * scope compiles each one into an HTTP endpoint. That is the whole reason the
 * authorization rules live *inside* these handlers rather than in route guards
 * — the endpoints are reachable directly, with no router involved.
 */

const credentialsSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const signUpSchema = credentialsSchema.extend({
  fullName: z.string().trim().min(1, "Tell us your name.").max(80),
});

function event() {
  const e = getRequestEvent();
  if (!e) throw new Error("No request event.");
  return e;
}

/**
 * Resolves the full session for the current user.
 *
 * The JWT already carries org memberships, but not organization names or the
 * resolved permission set. Those come from the database here, once per request,
 * and are then cached client-side by TanStack Query.
 *
 * Permissions are read from `role_permissions` rather than mirrored in
 * TypeScript, so the UI can never disagree with the database about what a role
 * may do.
 */
export async function getSession(): Promise<Session | null> {
  const e = event();
  if (!e.locals.auth) return null;

  const db = e.locals.supabase;
  const userId = e.locals.auth.userId;

  const [profileRes, membershipRes, permissionRes] = await Promise.all([
    db.from("profiles").select("id, email, full_name, avatar_url").eq("id", userId).single(),
    db.from("memberships").select("role, organizations!inner(id, slug, name)").eq("user_id", userId),
    db.from("role_permissions").select("role, permission"),
  ]);

  if (profileRes.error) return null;

  const permissionsByRole = new Map<AppRole, AppPermission[]>();
  for (const row of permissionRes.data ?? []) {
    const list = permissionsByRole.get(row.role) ?? [];
    list.push(row.permission);
    permissionsByRole.set(row.role, list);
  }

  const orgs: SessionOrg[] = (membershipRes.data ?? [])
    .map((m) => {
      const org = m.organizations as unknown as { id: string; slug: string; name: string };
      return {
        id: org.id,
        slug: org.slug,
        name: org.name,
        role: m.role,
        permissions: permissionsByRole.get(m.role) ?? [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const activeOrgId =
    e.locals.activeOrgId && orgs.some((o) => o.id === e.locals.activeOrgId)
      ? e.locals.activeOrgId
      : (orgs[0]?.id ?? null);

  return {
    user: {
      id: profileRes.data.id,
      email: profileRes.data.email,
      fullName: profileRes.data.full_name,
      avatarUrl: profileRes.data.avatar_url,
    },
    orgs,
    activeOrgId,
  };
}

export async function signInWithPassword(input: unknown): Promise<{ ok: true }> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) throw invalidInput("Check your details.", z.flattenError(parsed.error));

  // Two windows: a tight one per account, so a single target cannot be brute
  // forced, and a looser one per address, so one client cannot spray many
  // accounts while staying under the per-account limit.
  const email = parsed.data.email.toLowerCase();
  enforceRateLimit({ name: "sign-in", subject: email, limit: 5, windowMs: 15 * 60_000 });
  enforceRateLimit({ name: "sign-in-addr", limit: 30, windowMs: 15 * 60_000 });

  const { error } = await event().locals.supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Logged server-side because repeated failures are a security signal; the
    // client is told nothing beyond "invalid".
    log.warn("failed sign-in", { email });
    // Supabase distinguishes "no such user" from "wrong password"; the client is
    // told neither, so the endpoint cannot be used to discover which emails have
    // accounts.
    throw unauthenticated("Those credentials are not valid.");
  }

  log.info("sign-in succeeded", { email });
  return { ok: true };
}

export async function signUpWithPassword(input: unknown): Promise<{ ok: true; needsConfirmation: boolean }> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) throw invalidInput("Check your details.", z.flattenError(parsed.error));

  // Account creation is the classic target for automated abuse.
  enforceRateLimit({ name: "sign-up", limit: 5, windowMs: 60 * 60_000 });

  const { data, error } = await event().locals.supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  });

  if (error) {
    if (error.status === 422 || /already/i.test(error.message)) {
      throw conflict("That email is already registered.");
    }
    throw invalidInput("Could not create that account.");
  }

  return { ok: true, needsConfirmation: !data.session };
}

const resetRequestSchema = z.object({
  email: z.email("Enter a valid email address."),
});

/**
 * Starts a password reset.
 *
 * Always reports success, whatever happened. Reporting "no such account" here
 * would turn this endpoint into a membership oracle for any address someone
 * cares to try. Rate-limited per address for the same reason invites are: it
 * sends mail to an arbitrary recipient.
 *
 * Delivery is Supabase's own auth mailer rather than src/server/email.ts,
 * because the recovery link has to be minted by GoTrue.
 */
export async function requestPasswordReset(input: unknown): Promise<{ ok: true }> {
  const parsed = resetRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidInput("Enter a valid email address.", z.flattenError(parsed.error));
  }

  const email = parsed.data.email.trim().toLowerCase();

  enforceRateLimit({ name: "password-reset", subject: email, limit: 5, windowMs: 60 * 60_000 });

  const { error } = await event().locals.supabase.auth.resetPasswordForEmail(email, {
    redirectTo: appUrl("/reset-password"),
  });

  if (error) {
    // Logged, not surfaced: the caller learns nothing either way, by design.
    log.warn("password reset request failed", { error: error.message });
  }

  return { ok: true as const };
}

const updatePasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters."),
});

/**
 * Sets a new password for the caller.
 *
 * Requires an authenticated session, which is what the recovery link
 * establishes when the user lands on /reset-password — so this same endpoint
 * serves both "I forgot it" and "I want to change it".
 */
export async function updatePassword(input: unknown): Promise<{ ok: true }> {
  const parsed = updatePasswordSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidInput("Check the submitted values.", z.flattenError(parsed.error));
  }

  // Establishes that there is a session at all before touching credentials.
  requireAuth();

  const { error } = await event().locals.supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) throw conflict(error.message);

  return { ok: true as const };
}

export async function signOut(): Promise<{ ok: true }> {
  const e = event();
  await e.locals.supabase.auth.signOut();
  setCookie(ACTIVE_ORG_COOKIE, "", { maxAge: 0, path: "/" });
  return { ok: true };
}

/**
 * Switches the active tenant.
 *
 * Membership is re-checked here rather than trusted from the request, so the
 * cookie can never be hand-edited into a tenant the user does not belong to.
 */
export async function setActiveOrg(orgId: unknown): Promise<{ ok: true }> {
  const parsed = z.guid().safeParse(orgId);
  if (!parsed.success) throw invalidInput("Unknown organization.");

  const ctx = requireAuth();
  if (!ctx.orgs.some((o) => o.id === parsed.data)) throw invalidInput("Unknown organization.");

  setCookie(ACTIVE_ORG_COOKIE, parsed.data, {
    ...baseCookieOptions,
    maxAge: 60 * 60 * 24 * 365,
  });

  return { ok: true };
}
