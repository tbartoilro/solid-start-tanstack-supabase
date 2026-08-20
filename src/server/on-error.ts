import { AppError, isAppError } from "./errors";

/**
 * Last line of defence before an error crosses to the client.
 *
 * Wired up via `serverFunctions.onError` in vite.config.ts. Only server
 * functions invoked over the network pass through here.
 *
 * The rule is simple: errors we constructed deliberately are safe to send,
 * because their messages were written for a user to read. Everything else — a
 * Postgres constraint name, a stack trace, a failed internal fetch — describes
 * the inside of the system and is replaced with something generic, after being
 * logged in full on the server.
 */
export default async function onServerFunctionError(error: unknown): Promise<unknown> {
  // Responses carry thrown redirect()s; passing them through unchanged keeps
  // that control flow working.
  if (error instanceof Response) return error;

  // Returning undefined means "send what was thrown, unchanged".
  if (isAppError(error)) return undefined;

  console.error("[server-fn] unhandled error", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  return new AppError("internal", "Something went wrong. Please try again.");
}
