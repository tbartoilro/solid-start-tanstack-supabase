import { isProduction } from "~/lib/env";

/**
 * Cookie names and defaults live here rather than in `middleware.ts` so that
 * importing the constant does not drag the middleware module — and its default
 * export — into the server-function bundle.
 */
export const ACTIVE_ORG_COOKIE = "active_org";

export const baseCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax",
  path: "/",
} as const;
