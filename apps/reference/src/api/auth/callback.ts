import type { APIEvent } from "@solidjs/start/server";
import { log } from "~/server/log";

/**
 * The PKCE exchange point for links Supabase sends by email.
 *
 * Without this, password recovery cannot work at all. GoTrue's recovery link
 * points at its own `/auth/v1/verify`, which validates the token and then
 * redirects to the application with a short-lived `?code=` — a PKCE
 * authorization code, not a session. Something has to trade that code for
 * tokens and set the cookies, and until this route existed nothing did: the
 * browser landed on /reset-password with no session and was told, correctly but
 * uselessly, that the link was no longer valid.
 *
 * The same route serves email confirmation and any OAuth provider added later,
 * because they all arrive the same way.
 *
 * Served at `/auth/callback`, not `/api/auth/callback`: `routeDir: "./api"` makes
 * src/api the route root, so the directory name is not part of the URL. Whatever
 * value is passed as `redirectTo` must match, and must be allow-listed in
 * supabase/config.toml — GoTrue silently falls back to site_url otherwise.
 *
 * `next` is where to send the browser afterwards. It is treated as untrusted:
 * only same-origin absolute paths are followed, so a crafted link cannot turn
 * this into an open redirect.
 */
export async function GET(event: APIEvent) {
  const url = new URL(event.request.url);
  const code = url.searchParams.get("code");
  const requested = url.searchParams.get("next") ?? "/";

  const next =
    requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  if (!code) {
    // A missing code means the link was truncated, replayed after use, or
    // hand-crafted. There is nothing actionable to tell the visitor, so send
    // them somewhere that explains itself.
    return Response.redirect(new URL("/login", url), 303);
  }

  const { error } = await event.locals.supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Logged rather than surfaced: the reason a code failed (expired, already
    // spent, wrong verifier) is not the visitor's business and distinguishing
    // them would leak whether a link was ever valid.
    log.warn("auth callback could not exchange code", {
      requestId: event.locals.requestId,
      error: error.message,
    });
    return Response.redirect(new URL("/login", url), 303);
  }

  // The cookie writes queued by the Supabase client during the exchange are on
  // event.response.headers; a redirect Response of our own would drop them, so
  // they are copied across explicitly.
  const headers = new Headers({ location: new URL(next, url).toString() });
  for (const cookie of event.response.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }

  return new Response(null, { status: 303, headers });
}
