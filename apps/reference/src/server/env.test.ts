import { describe, expect, it } from "vitest";

/**
 * Regression test for a bug CI caught on its first ever run.
 *
 * `.env.example` ships `RESEND_API_KEY=` and `EMAIL_FROM=` blank, so the
 * documented `cp .env.example .env` produces empty strings rather than absent
 * variables. `z.string().min(1).optional()` accepts undefined and rejects "",
 * which meant every fresh clone failed to boot on variables it had been told
 * were optional. It passed locally only because the developer's own .env
 * predated those lines.
 *
 * The schema is re-declared here rather than imported because src/server/env.ts
 * parses `process.env` at module load and throws — there is no way to feed it a
 * second set of values from a test. Keep the two in step.
 */
import { z } from "zod";

function optional(schema: z.ZodType) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

const schema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  RESEND_API_KEY: optional(z.string().min(1)),
  EMAIL_FROM: optional(z.string().min(3)),
  PUBLIC_APP_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.url().default("http://localhost:4321"),
  ),
});

describe("server environment schema", () => {
  it("accepts the blank optionals that `cp .env.example .env` produces", () => {
    const result = schema.safeParse({
      SUPABASE_SECRET_KEY: "secret",
      RESEND_API_KEY: "",
      EMAIL_FROM: "",
      PUBLIC_APP_URL: "",
    });

    expect(result.success).toBe(true);
    expect(result.data?.RESEND_API_KEY).toBeUndefined();
    expect(result.data?.EMAIL_FROM).toBeUndefined();
    // Blank falls back rather than failing.
    expect(result.data?.PUBLIC_APP_URL).toBe("http://localhost:4321");
  });

  it("accepts them being absent entirely", () => {
    const result = schema.safeParse({ SUPABASE_SECRET_KEY: "secret" });
    expect(result.success).toBe(true);
  });

  it("still requires the secret key", () => {
    const result = schema.safeParse({ SUPABASE_SECRET_KEY: "" });
    expect(result.success).toBe(false);
  });

  it("still rejects a configured-but-malformed value", () => {
    // "" means "not configured"; a non-empty wrong value is a real mistake.
    expect(
      schema.safeParse({ SUPABASE_SECRET_KEY: "s", EMAIL_FROM: "no" }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ SUPABASE_SECRET_KEY: "s", PUBLIC_APP_URL: "not-a-url" }).success,
    ).toBe(false);
  });
});
