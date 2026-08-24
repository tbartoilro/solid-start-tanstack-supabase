import { getRequestEvent } from "solid-js/web";
import { isProduction } from "~/lib/env";

/**
 * Structured, request-scoped logging.
 *
 * Every line carries the `requestId` assigned in middleware, so the RPC call, the
 * database error it produced and the response the user saw can be stitched back
 * together from logs alone. That correlation is the entire point — without it,
 * a production incident is a pile of unrelated stack traces.
 *
 * Output is JSON in production (for log aggregators) and human-readable in dev.
 */
type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: Level = isProduction ? "info" : "debug";

/** Keys whose values must never reach a log sink. */
const REDACTED = new Set([
  "password",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "secret",
  "apikey",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED.has(key.toLowerCase()) ? "[redacted]" : redact(val, depth + 1);
  }
  return out;
}

function emit(level: Level, message: string, fields: Record<string, unknown> = {}) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  // Reading the request event is best-effort: these helpers are also called from
  // module scope and from code paths with no active request.
  let requestId: string | undefined;
  let userId: string | undefined;
  try {
    const event = getRequestEvent();
    requestId = event?.locals.requestId;
    userId = event?.locals.auth?.userId;
  } catch {
    /* no request context */
  }

  const entry = {
    level,
    message,
    requestId,
    userId,
    ...(redact(fields) as Record<string, unknown>),
    at: new Date().toISOString(),
  };

  const line = isProduction
    ? JSON.stringify(entry)
    : `${level.toUpperCase().padEnd(5)} ${message} ${
        Object.keys(fields).length ? JSON.stringify(redact(fields)) : ""
      }${requestId ? ` (req ${requestId.slice(0, 8)})` : ""}`;

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => emit("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit("error", message, fields),
};
