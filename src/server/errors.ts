/**
 * Error taxonomy for the RPC boundary.
 *
 * Two rules govern everything here:
 *
 * 1. An error that reaches the client carries only what the client is allowed
 *    to know. Database messages, constraint names and stack traces stay on the
 *    server — they describe schema internals.
 *
 * 2. A resource the caller may not see reports 404, not 403. A 403 confirms the
 *    resource exists, which is itself a leak: probing ids would let one tenant
 *    map another tenant's data even while every read fails.
 */
export type AppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "rate_limited"
  | "internal";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 422,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  /** Shape sent to the client. Deliberately minimal. */
  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export const unauthenticated = (msg = "You must be signed in.") =>
  new AppError("unauthenticated", msg);

/**
 * Preferred over `forbidden()` for anything tenant-scoped — see rule 2 above.
 */
export const notFound = (msg = "Not found.") => new AppError("not_found", msg);

/**
 * Only appropriate when the caller already provably knows the resource exists,
 * for example being told they lack permission inside an org they belong to.
 */
export const forbidden = (msg = "You do not have permission to do that.") =>
  new AppError("forbidden", msg);

export const invalidInput = (msg = "That input is not valid.", details?: unknown) =>
  new AppError("invalid_input", msg, details);

export const conflict = (msg: string) => new AppError("conflict", msg);

export const rateLimited = (msg = "Too many requests. Try again shortly.") =>
  new AppError("rate_limited", msg);

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
