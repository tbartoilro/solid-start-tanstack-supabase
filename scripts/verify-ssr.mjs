/**
 * Verifies the SolidStart <-> TanStack Router SSR seam against the real app.
 *
 * The load-bearing assertion is that authenticated loader data appears in the
 * *server response body* — fetched from Node with the session cookie, so there
 * is no client JavaScript involved at all — and that hydration then reuses it
 * instead of refetching.
 *
 *   npm run dev
 *   chromium --headless=new --remote-debugging-port=9222 &
 *   node scripts/verify-ssr.mjs
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
function cdp(ws, method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", onMsg);
      m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const target = await newTab();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

const consoleMsgs = [];
const serverFnCalls = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.consoleAPICalled") {
    consoleMsgs.push({
      level: m.params.type,
      text: m.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
    });
  }
  if (m.method === "Network.requestWillBeSent" && m.params.request.url.includes("/_server")) {
    serverFnCalls.push(m.params.request.url);
  }
});

await cdp(ws, "Runtime.enable");
await cdp(ws, "Page.enable");
await cdp(ws, "Network.enable");
await cdp(ws, "Network.clearBrowserCookies");

const evalJs = async (expression) => {
  const r = await cdp(ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
  return r.result.value;
};

// --- sign in through the real form, which also proves hydration ------------
await cdp(ws, "Page.navigate", { url: `${BASE}/login` });
await sleep(2500);
await evalJs(`document.querySelector("form.auth-form button[type=submit]").click()`);
await sleep(3500);

const landedOn = await evalJs(`location.pathname`);
check("login form works, so the page hydrated", landedOn === "/acme", landedOn);

// --- the real test: is loader data in the server's bytes? ------------------
const { cookies } = await cdp(ws, "Network.getAllCookies");
const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

const ssrHtml = await (
  await fetch(`${BASE}/acme/projects`, { headers: { cookie: cookieHeader } })
).text();

check(
  "authenticated loader data is in the server HTML",
  ssrHtml.includes("Web Platform"),
  `${ssrHtml.length} bytes`,
);
check(
  "the dehydrated query cache is inlined for the client",
  ssrHtml.includes('id="__QUERY_STATE__"') && ssrHtml.includes("Web Platform"),
);
check(
  "the shell is server-rendered too, not just a mount point",
  ssrHtml.includes("Acme Corporation") || ssrHtml.includes("Projects"),
);

// --- hydration must not refetch what SSR already sent ----------------------
serverFnCalls.length = 0;
await cdp(ws, "Page.navigate", { url: `${BASE}/acme/projects` });
await sleep(3000);

check(
  "hydration issues no server-function calls",
  serverFnCalls.length === 0,
  `${serverFnCalls.length} call(s)`,
);

const hydrationWarnings = consoleMsgs.filter((m) => /hydrat|mismatch|did not match/i.test(m.text));
check("no hydration mismatch warnings", hydrationWarnings.length === 0, JSON.stringify(hydrationWarnings.slice(0, 2)));

// --- client-side navigation keeps the JS context alive --------------------
await evalJs(`window.__spaMarker = "alive"`);
await evalJs(`document.querySelector('.sidebar nav a[href="/acme/members"]').click()`);
await sleep(2000);
const afterNav = await evalJs(`({ path: location.pathname, marker: window.__spaMarker ?? null })`);
check(
  "client-side navigation, no document reload",
  afterNav.path === "/acme/members" && afterNav.marker === "alive",
  JSON.stringify(afterNav),
);

console.log("\n──────────── SSR seam verification ────────────");
for (const { label, ok, detail } of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n        ${detail}` : ""}`);
}
const failed = results.filter((r) => !r.ok);
console.log("───────────────────────────────────────────────");
console.log(`${results.length - failed.length}/${results.length} passed`);
ws.close();
process.exit(failed.length ? 1 : 0);
