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
});

const parsed = serverSchema.safeParse({
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
});

if (!parsed.success) {
  throw new Error(
    `Invalid server environment — copy .env.example to .env.\n${z.prettifyError(parsed.error)}`,
  );
}

export const serverEnv = parsed.data;
