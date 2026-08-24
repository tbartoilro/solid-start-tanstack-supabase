import { getRequestEvent } from "solid-js/web";
import { rateLimited } from "./errors";
import { log } from "./log";

/**
 * Fixed-window rate limiting for the endpoints where abuse is cheap.
 *
 * ⚠ In-memory, therefore per-process. Behind more than one instance each gets
 * its own allowance, so the effective limit is `limit × instances`. That is an
 * acceptable trade for credential-stuffing and invite-spam slowdown, and it is
 * NOT sufficient where an exact global limit matters (billing, quotas). Moving
 * to a shared store means replacing `hits` below and nothing else — the call
 * sites do not change.
 */
const hits = new Map<string, { count: number; resetAt: number }>();

/** Cheap opportunistic sweep, so the map cannot grow without bound. */
function evictExpired(now: number) {
  if (hits.size < 5_000) return;
  for (const [key, entry] of hits) {
    if (entry.resetAt <= now) hits.delete(key);
  }
}

export interface RateLimitOptions {
  /** Distinguishes one limited operation from another. */
  name: string;
  /** Extra scoping beyond the client address, e.g. the submitted email. */
  subject?: string;
  limit: number;
  windowMs: number;
}

export function enforceRateLimit({ name, subject, limit, windowMs }: RateLimitOptions): void {
  const event = getRequestEvent();
  // `clientAddress` is derived from proxy headers, which a client can forge
  // unless the deployment sets a trusted-proxy configuration. Treat this as a
  // speed bump, never as an identity.
  const address = event?.clientAddress ?? "unknown";
  const key = `${name}:${address}:${subject ?? ""}`;

  const now = Date.now();
  evictExpired(now);

  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  entry.count += 1;
  if (entry.count > limit) {
    log.warn("rate limit exceeded", { operation: name, address, count: entry.count });
    throw rateLimited();
  }
}
