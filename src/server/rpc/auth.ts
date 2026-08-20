"use server";

import { setCookie } from "@solidjs/start/http";
import { getRequestEvent } from "solid-js/web";
import { z } from "zod";
import type { AppPermission, AppRole, Session, SessionOrg } from "~/lib/auth";
import { isProduction } from "~/lib/env";
import { requireAuth } from "~/server/context";
import { conflict, invalidInput, unauthenticated } from "~/server/errors";
import { ACTIVE_ORG_COOKIE, baseCookieOptions } from "~/server/cookies";

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

  const { error } = await event().locals.supabase.auth.signInWithPassword(parsed.data);

  // Supabase distinguishes "no such user" from "wrong password"; the client is
  // told neither, so the endpoint cannot be used to discover which emails have
  // accounts.
  if (error) throw unauthenticated("Those credentials are not valid.");

  return { ok: true };
}

export async function signUpWithPassword(input: unknown): Promise<{ ok: true; needsConfirmation: boolean }> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) throw invalidInput("Check your details.", z.flattenError(parsed.error));

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
