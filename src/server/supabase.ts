import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FetchEvent } from "@solidjs/start/server";
import { clientEnv, isProduction } from "~/lib/env";
import type { Database } from "~/lib/database.types";
import { serverEnv } from "./env";

export type Db = SupabaseClient<Database>;

/**
 * Request-scoped Supabase client that acts *as the signed-in user*.
 *
 * Every query issued through it is subject to RLS, which is what makes the
 * database the last line of defense: even a server function with a bug cannot
 * read another tenant's rows through this client.
 *
 * Auth cookies are `httpOnly`. That is a deliberate trade: it means no Supabase
 * client can run in the browser holding a session, and in exchange an XSS bug
 * cannot exfiltrate the user's tokens. All data access goes through server
 * functions, so nothing is lost.
 */
export function createRequestClient(event: FetchEvent): Db {
  return createServerClient<Database>(
    clientEnv.VITE_SUPABASE_URL,
    clientEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(event.request.headers.get("cookie") ?? "").map((c) => ({
            name: c.name,
            value: c.value ?? "",
          }));
        },
        setAll(cookiesToSet) {
          // `event.response.headers` is the outgoing header set for this
          // request, so appending here is enough — no separate buffer-and-flush
          // step is needed. This only works because the session refresh happens
          // in middleware, before any bytes are streamed.
          for (const { name, value, options } of cookiesToSet) {
            event.response.headers.append(
              "set-cookie",
              serializeCookieHeader(name, value, options),
            );
          }
        },
      },
      cookieOptions: {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        path: "/",
      },
    },
  );
}

/**
 * Client that bypasses RLS entirely.
 *
 * Reach for this only where an operation legitimately has no user authority to
 * act under — looking up an invitation by token before the invitee has an
 * account, for example. Every call site must do its own authorization first,
 * because the database will not do it for you here.
 */
export function createAdminClient(): Db {
  return createClient<Database>(clientEnv.VITE_SUPABASE_URL, serverEnv.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
