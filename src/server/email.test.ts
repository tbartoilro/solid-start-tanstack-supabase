import { describe, expect, it, vi } from "vitest";
import { appUrl, sendEmail } from "./email";

/**
 * Covers the branch a fresh clone actually runs: no RESEND_API_KEY configured.
 *
 * The contract being pinned here is that a missing key is a *degradation*, not
 * an error — services/members.ts sends the invite mail after the invitation row
 * has already committed, so a throw would report failure for work that
 * succeeded.
 */
describe("sendEmail without credentials", () => {
  it("reports not_configured instead of throwing", async () => {
    const result = await sendEmail({
      to: "someone@example.test",
      subject: "Test",
      text: "Body",
    });

    expect(result).toEqual({ delivered: false, reason: "not_configured" });
  });

  it("makes no network call at all", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await sendEmail({ to: "someone@example.test", subject: "Test", text: "Body" });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("appUrl", () => {
  it("builds an absolute URL from a path", () => {
    expect(appUrl("/accept-invite?token=abc")).toMatch(
      /^https?:\/\/[^/]+\/accept-invite\?token=abc$/,
    );
  });

  it("does not double up slashes", () => {
    expect(appUrl("/x")).not.toMatch(/\/\/x$/);
  });
});
