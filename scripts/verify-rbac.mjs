/**
 * Verifies the RBAC model against the real database, through the same PostgREST
 * surface a browser would use.
 *
 * Every assertion here is about RLS and the JWT hook only — the application is
 * not running. If these pass, the database refuses the right things even when
 * the app layer is bypassed entirely.
 *
 *   node scripts/verify-rbac.mjs
 */
import { execSync } from "node:child_process";

const status = JSON.parse(execSync("supabase status -o json", { encoding: "utf8" }));
const API = status.API_URL ?? "http://127.0.0.1:54321";
const KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;

const ACME_PROJECTS = 2; // Web Platform, Public API
const results = [];

function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
}

async function signIn(email) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const claims = JSON.parse(Buffer.from(body.access_token.split(".")[1], "base64url").toString());
  return { token: body.access_token, claims };
}

function rest(token) {
  return async (path, init = {}) => {
    const res = await fetch(`${API}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: KEY,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    let body = null;
    try {
      body = await res.json();
    } catch {}
    return { status: res.status, ok: res.ok, body };
  };
}

const users = {};
for (const email of [
  "owner@acme.test",
  "admin@acme.test",
  "member@acme.test",
  "viewer@acme.test",
  "outsider@globex.test",
]) {
  users[email] = await signIn(email);
}

// ---------------------------------------------------------------------------
// 1. Custom access token hook
// ---------------------------------------------------------------------------
const ownerClaims = users["owner@acme.test"].claims;
check(
  "JWT carries an `orgs` claim",
  Array.isArray(ownerClaims.orgs) && ownerClaims.orgs.length === 1,
  JSON.stringify(ownerClaims.orgs),
);
check(
  "JWT claim reports the correct per-org role",
  ownerClaims.orgs?.[0]?.role === "owner" && ownerClaims.orgs?.[0]?.slug === "acme",
);
check(
  "viewer's JWT claim says viewer, not owner",
  users["viewer@acme.test"].claims.orgs?.[0]?.role === "viewer",
);
check(
  "outsider's JWT only mentions their own tenant",
  users["outsider@globex.test"].claims.orgs?.length === 1 &&
    users["outsider@globex.test"].claims.orgs[0].slug === "globex",
);

// ---------------------------------------------------------------------------
// 2. Tenant isolation
// ---------------------------------------------------------------------------
const asOwner = rest(users["owner@acme.test"].token);
const asOutsider = rest(users["outsider@globex.test"].token);

const ownerProjects = await asOwner("projects?select=id,name,key");
check(
  "Acme owner sees exactly Acme's projects",
  ownerProjects.body?.length === ACME_PROJECTS,
  `saw ${ownerProjects.body?.length}`,
);
check(
  "Acme owner cannot see the other tenant's project",
  !JSON.stringify(ownerProjects.body).includes("Globex Internal"),
);

const outsiderProjects = await asOutsider("projects?select=id,name");
check(
  "Globex user sees only their own project",
  outsiderProjects.body?.length === 1 && outsiderProjects.body[0].name === "Globex Internal",
);

// Direct lookup of a known foreign id must also come back empty, not merely
// filtered from a list.
const stolen = await asOutsider("projects?select=id&id=eq.cccccccc-cccc-cccc-cccc-cccccccccccc");
check("Direct fetch of a foreign row by id returns nothing", stolen.body?.length === 0);

// ---------------------------------------------------------------------------
// 3. Permission enforcement per role
// ---------------------------------------------------------------------------
const asViewer = rest(users["viewer@acme.test"].token);
const asMember = rest(users["member@acme.test"].token);
const asAdmin = rest(users["admin@acme.test"].token);

const viewerRead = await asViewer("projects?select=id");
check("viewer CAN read projects", viewerRead.body?.length === ACME_PROJECTS);

const viewerInsert = await asViewer("projects", {
  method: "POST",
  body: JSON.stringify({
    org_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    name: "Viewer Should Not Create",
    key: "VSC",
  }),
});
check("viewer CANNOT create a project", viewerInsert.status === 403, `got ${viewerInsert.status}`);

const viewerIssue = await asViewer("issues", {
  method: "POST",
  body: JSON.stringify({
    org_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    project_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    title: "viewer writes an issue",
  }),
});
check("viewer CANNOT create an issue", viewerIssue.status === 403, `got ${viewerIssue.status}`);

const memberIssue = await asMember("issues", {
  method: "POST",
  headers: { prefer: "return=representation" },
  body: JSON.stringify({
    org_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    project_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    title: "member writes an issue",
  }),
});
check("member CAN create an issue", memberIssue.status === 201, `got ${memberIssue.status}`);
check(
  "issue number auto-assigned per project",
  typeof memberIssue.body?.[0]?.number === "number" && memberIssue.body[0].number > 0,
  `number=${memberIssue.body?.[0]?.number}`,
);

const memberDeleteProject = await asMember(
  "projects?id=eq.dddddddd-dddd-dddd-dddd-dddddddddddd",
  { method: "DELETE" },
);
// RLS turns an unauthorized DELETE into "no rows matched" rather than an error,
// so the project still existing is the real assertion.
const stillThere = await asAdmin("projects?select=id&id=eq.dddddddd-dddd-dddd-dddd-dddddddddddd");
check(
  "member CANNOT delete a project",
  stillThere.body?.length === 1,
  `delete status ${memberDeleteProject.status}`,
);

// ---------------------------------------------------------------------------
// 4. Audit log visibility follows audit.read
// ---------------------------------------------------------------------------
const adminAudit = await asAdmin("audit_log?select=id,action");
const memberAudit = await asMember("audit_log?select=id,action");
check("admin CAN read the audit log", (adminAudit.body?.length ?? 0) > 0, `${adminAudit.body?.length} rows`);
check("member CANNOT read the audit log", memberAudit.body?.length === 0);

const forged = await asAdmin("audit_log", {
  method: "POST",
  body: JSON.stringify({
    org_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    action: "forged.entry",
  }),
});
check(
  "nobody can write the audit log through the API",
  forged.status === 403 || forged.status === 401,
  `got ${forged.status}`,
);

// ---------------------------------------------------------------------------
// 5. Invariants
// ---------------------------------------------------------------------------
const ownerMembership = await asOwner(
  "memberships?select=id&org_id=eq.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa&role=eq.owner",
);
const removeLastOwner = await asOwner(`memberships?id=eq.${ownerMembership.body?.[0]?.id}`, {
  method: "DELETE",
});
check(
  "the last owner cannot be removed",
  removeLastOwner.status >= 400,
  `got ${removeLastOwner.status} ${JSON.stringify(removeLastOwner.body?.message ?? "")}`,
);

// A member must not be able to promote themselves.
const selfPromote = await asMember(
  "memberships?user_id=eq.33333333-3333-3333-3333-333333333333",
  { method: "PATCH", body: JSON.stringify({ role: "owner" }) },
);
const memberRoleNow = await asAdmin(
  "memberships?select=role&user_id=eq.33333333-3333-3333-3333-333333333333",
);
check(
  "a member cannot promote themselves to owner",
  memberRoleNow.body?.[0]?.role === "member",
  `role is now ${memberRoleNow.body?.[0]?.role} (patch status ${selfPromote.status})`,
);

// ---------------------------------------------------------------------------
console.log("\n──────────── RBAC / RLS verification ────────────");
for (const { label, ok, detail } of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail && !ok ? `  [${detail}]` : ""}`);
}
const failed = results.filter((r) => !r.ok);
console.log("─────────────────────────────────────────────────");
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
