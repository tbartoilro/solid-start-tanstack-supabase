import { z } from "zod";

/**
 * Server-only environment.
 *
 * This module must never be imported from a component or any module reachable
 * from the client graph. It is only ever pulled in from inside `"use server"`
 * boundaries and from `src/middleware.ts`, both of which are server-exclusive.
 */

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),

  // Transactional email. Optional on purpose: local development should not
  // require a vendor account, and `src/server/email.ts` degrades to logging the
  // message when the key is absent. Set both in production or invitations will
  // be created without ever reaching the invitee.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),

  // Absolute origin used to build links in outbound mail. Defaults to the dev
  // server's pinned port (vite.config.ts) so a local invite link is clickable;
  // production must set it explicitly or links will point at localhost.
  PUBLIC_APP_URL: z.url().default("http://localhost:4321"),
});

const parsed = serverSchema.safeParse({
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
});

if (!parsed.success) {
  throw new Error(
    `Invalid server environment — copy .env.example to .env.\n${z.prettifyError(parsed.error)}`,
  );
}

export const serverEnv = parsed.data;
