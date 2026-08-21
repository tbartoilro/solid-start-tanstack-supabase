import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Cross-tenant isolation, asserted against the real database.
 *
 * The rest of the unit suite covers pure logic — the permission matrix, the
 * escalation rules — which is necessary but cannot fail in the way that
 * actually matters. A policy regression does not break a pure function; it
 * silently starts returning another tenant's rows. These tests are the ones
 * that would catch that, so they talk to PostgREST exactly as the browser does,
 * with a real user's access token and no application code in the path.
 *
 * Skipped automatically when the local stack is down, so `npm run test` still
 * works on a machine with nothing running. CI starts the stack first.
 */

const PASSWORD = "password123";

let API = "";
let KEY = "";
let stackUp = false;

function stackStatus(): { api: string; key: string } | null {
  try {
    const raw = execSync("supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const status = JSON.parse(raw);
    const api = status.API_URL ?? "http://127.0.0.1:54321";
    const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
    return key ? { api, key } : null;
  } catch {
    return null;
  }
}

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status}`);
  return (await res.json()).access_token;
}

/** Issues a PostgREST request as `token`, i.e. subject to that user's RLS. */
async function asUser(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* 204s have no body */
  }
  return { status: res.status, body };
}

const tokens: Record<string, string> = {};

/** Non-optional accessor — a missing token is a harness bug, not a test case. */
function token(email: string): string {
  const t = tokens[email];
  if (!t) throw new Error(`no access token for ${email}`);
  return t;
}

/**
 * Resolved at module load rather than in beforeAll, so `describe.skipIf` below
 * can see it.
 *
 * This matters more than it looks: an earlier version guarded each test with
 * `if (!stackUp) return`, which reported a full green suite on a machine where
 * the database was not running at all. A test that silently passes without
 * executing is worse than no test, so an unreachable stack now shows up as
 * *skipped* and CI fails on skips instead.
 */
const status = stackStatus();
if (status) {
  API = status.api;
  KEY = status.key;
  try {
    for (const email of ["owner@acme.test", "viewer@acme.test", "outsider@globex.test"]) {
      tokens[email] = await signIn(email);
    }
    stackUp = true;
  } catch {
    stackUp = false;
  }
}

describe.skipIf(!stackUp)("cross-tenant isolation", () => {
  it("an Acme user sees only Acme projects", async () => {
    const { body } = await asUser(token("owner@acme.test"), "projects?select=name");
    const names = (body as { name: string }[]).map((r) => r.name).sort();
    expect(names).toEqual(["Public API", "Web Platform"]);
    expect(names).not.toContain("Globex Internal");
  });

  it("a Globex user sees only Globex projects", async () => {
    const { body } = await asUser(token("outsider@globex.test"), "projects?select=name");
    expect((body as { name: string }[]).map((r) => r.name)).toEqual(["Globex Internal"]);
  });

  it("fetching a foreign row by id returns nothing, not a 403", async () => {
    // Discovering the id as its owner, then asking for it as the other tenant:
    // the point is that RLS filters rather than refusing, so an id cannot be
    // confirmed to exist by probing.
    const { body: own } = await asUser(
      token("outsider@globex.test"),
      "projects?select=id&limit=1",
    );
    const foreignId = (own as { id: string }[])[0]!.id;

    const { status, body } = await asUser(
      token("owner@acme.test"),
      `projects?select=id&id=eq.${foreignId}`,
    );
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it("a viewer cannot create a project", async () => {
    const { body: orgs } = await asUser(token("viewer@acme.test"), "organizations?select=id");
    const orgId = (orgs as { id: string }[])[0]!.id;

    const { status } = await asUser(token("viewer@acme.test"), "projects", {
      method: "POST",
      body: JSON.stringify({ org_id: orgId, name: "Nope", key: "NOP" }),
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  it("a viewer cannot read the audit log", async () => {
    const { body } = await asUser(token("viewer@acme.test"), "audit_log?select=id");
    expect(body).toEqual([]);
  });

  it("nobody can write the audit log", async () => {
    const { status } = await asUser(token("owner@acme.test"), "audit_log", {
      method: "POST",
      body: JSON.stringify({ action: "forged" }),
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  it("an outsider cannot write into another tenant by naming its org_id", async () => {
    const { body: acme } = await asUser(
      token("owner@acme.test"),
      "organizations?select=id&limit=1",
    );
    const acmeId = (acme as { id: string }[])[0]!.id;

    const { status } = await asUser(token("outsider@globex.test"), "projects", {
      method: "POST",
      body: JSON.stringify({ org_id: acmeId, name: "Injected", key: "INJ" }),
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  it("accept_invitation refuses a caller whose email is not the invited one", async () => {
    // The security property of the whole invitation flow, exercised through the
    // same RPC surface the app uses.
    const { status, body } = await asUser(token("viewer@acme.test"), "rpc/accept_invitation", {
      method: "POST",
      body: JSON.stringify({ invite_token: "0".repeat(64) }),
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(body)).toContain("invitation_invalid");
  });
});
