import type { FetchEvent } from "@solidjs/start/server";
import { isProduction } from "~/lib/env";

/**
 * Security response headers, including a per-request CSP nonce.
 *
 * Two things make a genuinely strict policy possible here:
 *
 *   - `serialization.mode` defaults to "json", so server-function payloads are
 *     `JSON.parse`d rather than evaluated. No `'unsafe-eval'` needed.
 *   - Auth cookies are httpOnly and no Supabase client runs in the browser, so
 *     the page never talks to the Supabase API directly and `connect-src` can
 *     stay `'self'`.
 *
 * The policy is production-only: Vite's dev client needs inline scripts, eval
 * and a websocket, and shipping a policy that has to be relaxed for dev tends
 * to end with the relaxed version in production.
 */
export function applySecurityHeaders(event: FetchEvent, nonce: string): void {
  const headers = event.response.headers;

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );

  if (!isProduction) return;

  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // 'strict-dynamic' lets the nonced entry script load the rest of the
      // module graph without every chunk needing its own nonce.
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      // Solid injects component styles as inline <style> during hydration, which
      // cannot currently carry a nonce. This is the one concession in the policy.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
}
