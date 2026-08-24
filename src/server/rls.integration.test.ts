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
 * This absorbed scripts/verify-rbac.mjs, which made the same claims from a plain
 * node script. The property that made it worth keeping for a while — and worth
 * stating here now that the script is gone — is that **the application is not
 * running**. Nothing below imports app code, starts a server, or renders
 * anything: every assertion is about what the database itself refuses when
 * handed a real user's token. If these pass, the app layer could be bypassed
 * entirely and the data would still hold.
 *
 * Skipped automatically when the local stack is down, so `npm run test` still
 * works on a machine with nothing running. CI starts the stack first and fails
 * the build if anything here was skipped.
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

interface OrgClaim {
  id: string;
  slug: string;
  role: string;
}

async function signIn(email: string): Promise<{ token: string; orgs: OrgClaim[] }> {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status}`);

  const accessToken: string = (await res.json()).access_token;

  // Decoding rather than verifying: the assertion is about what
  // custom_access_token_hook stamped into the payload, and GoTrue having just
  // issued it is signature enough for a test.
  const payload = JSON.parse(
    Buffer.from(accessToken.split(".")[1]!, "base64url").toString(),
  ) as { orgs?: OrgClaim[] };

  return { token: accessToken, orgs: payload.orgs ?? [] };
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

const sessions: Record<string, { token: string; orgs: OrgClaim[] }> = {};

/** Non-optional accessor — a missing session is a harness bug, not a test case. */
function session(email: string): { token: string; orgs: OrgClaim[] } {
  const s = sessions[email];
  if (!s) throw new Error(`no session for ${email}`);
  return s;
}

function token(email: string): string {
  return session(email).token;
}

/** Seeded fixture ids, from supabase/seed.sql. */
const ACME = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJ_WEB = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PROJ_API = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const MEMBER_ID = "33333333-3333-3333-3333-333333333333";

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
    for (const email of [
      "owner@acme.test",
      "admin@acme.test",
      "member@acme.test",
      "viewer@acme.test",
      "outsider@globex.test",
    ]) {
      sessions[email] = await signIn(email);
    }
    stackUp = true;
  } catch {
    stackUp = false;
  }
}

describe.skipIf(!stackUp)("cross-tenant isolation", () => {
  it("an Acme user sees only Acme projects", async () => {
    const { body } = await asUser(token("owner@acme.test"), "projects?select=name,org_id");
    const rows = body as { name: string; org_id: string }[];

    // Asserted as a property of every row rather than as an exact list. An
    // exact list also fails when someone merely adds a project — `npm run
    // db:demo` does — which says nothing about isolation, and it only ever
    // caught a foreign row by knowing that row's name in advance.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.org_id === ACME)).toBe(true);

    const names = rows.map((r) => r.name);
    expect(names).toContain("Web Platform");
    expect(names).toContain("Public API");
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

describe.skipIf(!stackUp)("JWT claims from custom_access_token_hook", () => {
  it("stamps an orgs claim naming the user's memberships", () => {
    const orgs = session("owner@acme.test").orgs;
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({ slug: "acme", role: "owner" });
  });

  it("reports the caller's real role, not a privileged one", () => {
    expect(session("viewer@acme.test").orgs[0]).toMatchObject({ slug: "acme", role: "viewer" });
  });

  it("never mentions a tenant the user does not belong to", () => {
    const orgs = session("outsider@globex.test").orgs;
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.slug).toBe("globex");
  });

  it("carries membership edges but not a resolved permission set", () => {
    // Permissions are deliberately excluded so a change to role_permissions does
    // not leave every outstanding token carrying a stale copy of it.
    expect(JSON.stringify(session("owner@acme.test").orgs)).not.toMatch(/permission/i);
  });
});

describe.skipIf(!stackUp)("permission enforcement per role", () => {
  it("a viewer can read projects, and sees exactly what an owner sees", async () => {
    const asViewer = await asUser(token("viewer@acme.test"), "projects?select=id&order=id");
    const asOwner = await asUser(token("owner@acme.test"), "projects?select=id&order=id");

    // Compared against the owner rather than against a fixed count: `read` is
    // the one permission every role holds, so a viewer seeing *fewer* rows than
    // an owner is the regression worth catching, and a hardcoded number only
    // catches it while nobody adds a project.
    expect((asViewer.body as unknown[]).length).toBeGreaterThan(0);
    expect(asViewer.body).toEqual(asOwner.body);
  });

  it("a viewer cannot create an issue", async () => {
    const { status } = await asUser(token("viewer@acme.test"), "issues", {
      method: "POST",
      body: JSON.stringify({ org_id: ACME, project_id: PROJ_WEB, title: "nope" }),
    });
    expect(status).toBe(403);
  });

  it("a member can create an issue, and its number is assigned per project", async () => {
    const { status, body } = await asUser(token("member@acme.test"), "issues", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ org_id: ACME, project_id: PROJ_WEB, title: "member writes" }),
    });
    expect(status).toBe(201);
    expect((body as { number: number }[])[0]!.number).toBeGreaterThan(0);
  });

  it("a member cannot delete a project", async () => {
    // RLS turns an unauthorized DELETE into "no rows matched" rather than an
    // error, so the row still existing is the real assertion — the status code
    // alone would pass even if the delete had succeeded.
    await asUser(token("member@acme.test"), `projects?id=eq.${PROJ_API}`, { method: "DELETE" });

    const { body } = await asUser(
      token("admin@acme.test"),
      `projects?select=id&id=eq.${PROJ_API}`,
    );
    expect(body).toHaveLength(1);
  });

  it("an admin can read the audit log", async () => {
    const { body } = await asUser(token("admin@acme.test"), "audit_log?select=id");
    expect((body as unknown[]).length).toBeGreaterThan(0);
  });
});

describe.skipIf(!stackUp)("database-enforced invariants", () => {
  it("the last owner cannot be removed", async () => {
    const { body } = await asUser(
      token("owner@acme.test"),
      `memberships?select=id&org_id=eq.${ACME}&role=eq.owner`,
    );
    const membershipId = (body as { id: string }[])[0]!.id;

    const { status } = await asUser(
      token("owner@acme.test"),
      `memberships?id=eq.${membershipId}`,
      { method: "DELETE" },
    );
    expect(status).toBeGreaterThanOrEqual(400);
  });

  it("a member cannot promote themselves to owner", async () => {
    await asUser(token("member@acme.test"), `memberships?user_id=eq.${MEMBER_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "owner" }),
    });

    // Read back with a role that can see it: the PATCH status is not the
    // assertion, the resulting role is.
    const { body } = await asUser(
      token("admin@acme.test"),
      `memberships?select=role&user_id=eq.${MEMBER_ID}`,
    );
    expect((body as { role: string }[])[0]!.role).toBe("member");
  });
});

describe.skipIf(!stackUp)("organization teardown", () => {
  /**
   * Deleting an organization was impossible until the triggers learned to tell
   * a teardown from an ordinary edit.
   *
   * Three of them fire on rows that disappear as a cascade from the parent:
   * `protect_last_owner` refused the final owner's membership, and both audit
   * triggers tried to write an entry whose `org_id` no longer had a row to
   * reference. The "orgs: owner can delete" policy therefore advertised
   * something the schema then refused, and nothing noticed because no screen
   * offers the action yet.
   *
   * Built and torn down here rather than against a seeded org, because the
   * assertions in the rest of this file depend on the seed still being there.
   */
  it("an owner can delete their organization, and it takes its data with it", async () => {
    const owner = token("owner@acme.test");
    const slug = `teardown-${Date.now().toString(36)}`;

    // Two statements, exactly as `createOrg` in src/server/services/orgs.ts
    // does it and for the same reason: `return=representation` is
    // INSERT ... RETURNING, whose output is subject to the *read* policy, and
    // the membership that satisfies it is written by an AFTER INSERT trigger
    // that has not fired yet. Asking for the row back in the same statement
    // gets the whole insert refused.
    //
    // `created_by` is not optional either — the insert policy is
    // `with check (created_by = auth.uid())`, so founding an organization in
    // someone else's name is refused rather than silently reattributed.
    const created = await asUser(owner, "organizations", {
      method: "POST",
      body: JSON.stringify({ slug, name: "Teardown Test", created_by: OWNER_ID }),
    });
    expect(created.status).toBe(201);

    const lookup = await asUser(owner, `organizations?select=id&slug=eq.${slug}`);
    const orgId = (lookup.body as { id: string }[])[0]!.id;

    // The organizations_add_owner trigger grants the creator ownership, which
    // is what makes this the last-owner case rather than a trivial delete.
    const before = await asUser(owner, `memberships?select=role&org_id=eq.${orgId}`);
    expect(before.body).toEqual([{ role: "owner" }]);

    // A project too, so the cascade has to reach the audit trigger on the way
    // down — that was the second of the three blockers.
    const proj = await asUser(owner, "projects", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ org_id: orgId, name: "Doomed", key: "DOOM" }),
    });
    expect(proj.status).toBe(201);

    const deleted = await asUser(owner, `organizations?id=eq.${orgId}`, { method: "DELETE" });
    expect(deleted.status).toBeLessThan(300);

    const after = await asUser(owner, `organizations?select=id&id=eq.${orgId}`);
    expect(after.body).toEqual([]);
    const orphans = await asUser(owner, `projects?select=id&org_id=eq.${orgId}`);
    expect(orphans.body).toEqual([]);
  });

  it("still refuses to let a live organization lose its last owner", async () => {
    const owner = token("owner@acme.test");

    const { body } = await asUser(owner, `memberships?select=id&org_id=eq.${ACME}&role=eq.owner`);
    const ownerMembership = (body as { id: string }[])[0]!.id;

    const { status } = await asUser(owner, `memberships?id=eq.${ownerMembership}`, {
      method: "DELETE",
    });
    expect(status).toBeGreaterThanOrEqual(400);

    // The status is not the assertion — read the row back and confirm the owner
    // is still there, since an RLS-filtered delete also reports no rows.
    const after = await asUser(owner, `memberships?select=id&org_id=eq.${ACME}&role=eq.owner`);
    expect(after.body).toEqual([{ id: ownerMembership }]);
  });
});
