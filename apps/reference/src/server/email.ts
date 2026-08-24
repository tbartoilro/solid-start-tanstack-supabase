import { serverEnv } from "./env";
import { log } from "./log";

/**
 * Outbound transactional email.
 *
 * Called through Resend's REST API with `fetch` rather than their SDK — the
 * payload is three fields and the response is ignored beyond success, so a
 * dependency would buy nothing.
 *
 * Two deliberate properties:
 *
 *   - **Optional in development.** With no `RESEND_API_KEY` the message is
 *     logged instead of sent, so a fresh clone can exercise the invite flow
 *     without signing up to anything. The link is printed so it stays usable.
 *
 *   - **Never throws.** Every caller here is sending mail as a side effect of a
 *     database write that has already committed. Failing the request at that
 *     point would report failure for work that actually succeeded, so send
 *     failures are logged and reported in the return value instead.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  /** Plain text. Kept text-only so there is no HTML escaping to get wrong. */
  text: string;
}

export type SendEmailResult =
  | { delivered: true }
  | { delivered: false; reason: "not_configured" | "send_failed" };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = serverEnv.RESEND_API_KEY;
  const from = serverEnv.EMAIL_FROM;

  if (!apiKey || !from) {
    log.info("email not configured — logging instead of sending", {
      to: input.to,
      subject: input.subject,
      body: input.text,
    });
    return { delivered: false, reason: "not_configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to: input.to, subject: input.subject, text: input.text }),
    });

    if (!response.ok) {
      // Resend's error body can echo the recipient address; log the status only.
      log.error("email send rejected", { to: input.to, status: response.status });
      return { delivered: false, reason: "send_failed" };
    }

    return { delivered: true };
  } catch (error) {
    log.error("email send threw", {
      to: input.to,
      error: error instanceof Error ? error.message : String(error),
    });
    return { delivered: false, reason: "send_failed" };
  }
}

/** Absolute URL for a path, for use in outbound mail. */
export function appUrl(path: string): string {
  return new URL(path, serverEnv.PUBLIC_APP_URL).toString();
}
