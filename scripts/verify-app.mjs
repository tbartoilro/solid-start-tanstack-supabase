/**
 * End-to-end verification of the running application.
 *
 * The interesting assertions are the ones that bypass the UI entirely: they
 * import the server-function stubs straight from the page and invoke them, the
 * same way anyone with devtools open can. If route guards were doing the real
 * work, these would succeed. They must not.
 *
 *   npm run dev    # in another terminal
 *   chromium --headless=new --remote-debugging-port=9222 &
 *   node scripts/verify-app.mjs
 */
const BASE = process.env.BASE ?? "http://localhost:4321";
const PORT = Number(process.env.CDP_PORT ?? 9222);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (label, ok, detail = "") => results.push({ label, ok, detail });

async function newTab() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" });
      if (res.ok) return res.json();
    } catch {}
    await sleep(500);
  }
  throw new Error("chromium CDP unreachable — start it with --remote-debugging-port=9222");
}

let seq = 0;
function rpc(ws, method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      ws.removeEventListener("message", onMsg);
      msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const target = await newTab();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
await rpc(ws, "Runtime.enable");
await rpc(ws, "Page.enable");
await rpc(ws, "Network.enable");
// Start from a clean slate: a leftover session cookie would redirect /login
// straight to the dashboard and every assertion below would test the wrong user.
await rpc(ws, "Network.clearBrowserCookies");

const consoleErrors = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  }
});

const evalJs = async (expression) => {
  const r = await rpc(ws, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
  }
  return r.result.value;
};

async function goto(path) {
  await rpc(ws, "Page.navigate", { url: BASE + path });
  await sleep(2200);
}

async function signIn(email) {
  await rpc(ws, "Network.clearBrowserCookies");
  await goto("/login");
  await evalJs(`
    (() => {
      const form = document.querySelector("form.auth-form");
      if (!form) throw new Error("no login form at " + location.pathname);
      form.querySelector('input[type=email]').value = ${JSON.stringify(email)};
      form.querySelector('input[type=password]').value = "password123";
      // Solid listens for input events, not direct value assignment.
      for (const el of form.querySelectorAll("input")) {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      form.querySelector("button[type=submit]").click();
      return true;
    })()
  `);
  await sleep(2600);
}

/** Calls a server function straight from the page — no router, no UI. */
async function callRpc(module, fn, arg) {
  return evalJs(`
    (async () => {
      try {
        const mod = await import(${JSON.stringify(`/src/server/rpc/${module}.ts`)});
        const value = await mod[${JSON.stringify(fn)}](${JSON.stringify(arg)});
        return { ok: true, value };
      } catch (err) {
        return { ok: false, message: String(err?.message ?? err), code: err?.code ?? null };
      }
    })()
  `);
}

const bodyText = () => evalJs(`document.body.innerText`);
const navLinks = () =>
  evalJs(`Array.from(document.querySelectorAll(".sidebar nav a")).map(a => a.textContent.trim())`);

// ===========================================================================
// viewer@acme.test — read-only
// ===========================================================================
await signIn("viewer@acme.test");

const viewerPath = await evalJs(`location.pathname`);
check("viewer lands on their org dashboard after sign-in", viewerPath === "/acme", viewerPath);

const viewerBody = await bodyText();
check("dashboard renders the organization", viewerBody.includes("Acme Corporation"));

const viewerNav = await navLinks();
check("viewer nav omits Settings", !viewerNav.includes("Settings"), viewerNav.join("|"));
check("viewer nav omits Audit log", !viewerNav.includes("Audit log"), viewerNav.join("|"));
check("viewer nav still offers Projects", viewerNav.includes("Projects"));

await goto("/acme/projects");
const viewerProjects = await bodyText();
check("viewer can read projects", viewerProjects.includes("Web Platform"));
check(
  "viewer is not offered a create-project form",
  !(await evalJs(`!!document.querySelector("form.inline-form")`)),
);

// --- the important part: bypass the UI completely -------------------------
const viewerCreate = await callRpc("projects", "createProject", {
  orgSlug: "acme",
  name: "Bypassed the UI",
  key: "HACK",
});
check(
  "viewer calling createProject directly is REFUSED",
  viewerCreate.ok === false,
  JSON.stringify(viewerCreate),
);

const viewerAudit = await callRpc("org", "listAuditLog", { orgSlug: "acme", page: 1 });
check(
  "viewer calling listAuditLog directly is REFUSED",
  viewerAudit.ok === false,
  JSON.stringify(viewerAudit),
);

const viewerInvite = await callRpc("members", "inviteMember", {
  orgSlug: "acme",
  email: "sneaky@acme.test",
  role: "owner",
});
check(
  "viewer calling inviteMember directly is REFUSED",
  viewerInvite.ok === false,
  JSON.stringify(viewerInvite),
);

// Cross-tenant read attempted straight at the endpoint.
const viewerCrossTenant = await callRpc("projects", "listProjects", { orgSlug: "globex" });
check(
  "viewer cannot reach another tenant via direct RPC",
  viewerCrossTenant.ok === false,
  JSON.stringify(viewerCrossTenant),
);

// ===========================================================================
// owner@acme.test — full access within their tenant only
// ===========================================================================
await signIn("owner@acme.test");

const ownerNav = await navLinks();
check("owner nav includes Settings", ownerNav.includes("Settings"), ownerNav.join("|"));
check("owner nav includes Audit log", ownerNav.includes("Audit log"), ownerNav.join("|"));

const ownerCreate = await callRpc("projects", "createProject", {
  orgSlug: "acme",
  name: "Owner Created",
  key: "OWN",
});
check("owner CAN create a project", ownerCreate.ok === true, JSON.stringify(ownerCreate));

if (ownerCreate.ok) {
  const cleanup = await callRpc("projects", "deleteProject", {
    orgSlug: "acme",
    projectId: ownerCreate.value.id,
  });
  check("owner CAN delete a project", cleanup.ok === true, JSON.stringify(cleanup));
}

// Tenant isolation for a fully-privileged user.
const ownerCrossTenant = await callRpc("projects", "listProjects", { orgSlug: "globex" });
check(
  "owner cannot reach another tenant via direct RPC",
  ownerCrossTenant.ok === false,
  JSON.stringify(ownerCrossTenant),
);

await goto("/globex");
const globexBody = await bodyText();
check(
  "navigating to a foreign org shows Not found",
  /not found/i.test(globexBody),
  globexBody.slice(0, 80),
);

// Self-promotion guard: an owner may not edit their own role.
const members = await callRpc("members", "listMembers", { orgSlug: "acme" });
if (members.ok) {
  const self = members.value.find((m) => m.email === "owner@acme.test");
  const selfEdit = await callRpc("members", "changeMemberRole", {
    orgSlug: "acme",
    membershipId: self.membershipId,
    role: "viewer",
  });
  check(
    "owner cannot change their own role",
    selfEdit.ok === false,
    JSON.stringify(selfEdit),
  );
}

// ===========================================================================
// admin@acme.test — has members.manage, must not be able to mint an owner
// ===========================================================================
await signIn("admin@acme.test");
const adminMembers = await callRpc("members", "listMembers", { orgSlug: "acme" });
if (adminMembers.ok) {
  const target = adminMembers.value.find((m) => m.email === "member@acme.test");
  const escalate = await callRpc("members", "changeMemberRole", {
    orgSlug: "acme",
    membershipId: target.membershipId,
    role: "owner",
  });
  check(
    "admin cannot promote anyone to owner (escalation guard)",
    escalate.ok === false,
    JSON.stringify(escalate),
  );
}

// ===========================================================================
console.log("\n──────────── application verification ────────────");
for (const { label, ok, detail } of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n        ${detail}` : ""}`);
}
const failed = results.filter((r) => !r.ok);
console.log("──────────────────────────────────────────────────");
console.log(`${results.length - failed.length}/${results.length} passed`);
ws.close();
process.exit(failed.length ? 1 : 0);
