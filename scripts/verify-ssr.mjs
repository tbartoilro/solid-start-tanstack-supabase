/**
 * Phase 0 exit-criteria verifier.
 *
 * Drives headless Chromium over CDP against a single page load so that the
 * SSR-embedded values and the post-hydration DOM can be compared like-for-like.
 */
const BASE = process.env.BASE ?? "http://localhost:4321";
const PORT = 9222;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" });
      if (res.ok) return await res.json();
    } catch {}
    await sleep(500);
  }
  throw new Error("chromium CDP never became reachable");
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

const target = await cdpTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

const consoleMsgs = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Runtime.consoleAPICalled") {
    consoleMsgs.push({
      level: msg.params.type,
      text: msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
    });
  }
  if (msg.method === "Log.entryAdded") {
    consoleMsgs.push({ level: msg.params.entry.level, text: msg.params.entry.text });
  }
});

await rpc(ws, "Runtime.enable");
await rpc(ws, "Log.enable");
await rpc(ws, "Page.enable");
await rpc(ws, "Network.enable");

// Track every request the page makes, so a loader refetch is observable.
const requests = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Network.requestWillBeSent") {
    requests.push({ url: msg.params.request.url, method: msg.params.request.method });
  }
});

await rpc(ws, "Page.navigate", { url: BASE + "/" });
await sleep(3500);

const evalJs = async (expr) => {
  const r = await rpc(ws, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result.value;
};

// --- Criterion 1 & 3: the value baked into the SSR payload is the value the
// hydrated DOM shows. Same request, so any mismatch means a client refetch.
const ssrPayloadId = await evalJs(`
  (() => {
    const el = document.getElementById("__QUERY_STATE__");
    if (!el) return null;
    const q = JSON.parse(el.textContent).queries[0];
    return q?.state?.data?.id ?? null;
  })()
`);
const renderedId = await evalJs(`document.getElementById("loader-id")?.textContent ?? null`);

// --- Criterion 2: hydration warnings
const hydrationWarnings = consoleMsgs.filter((m) =>
  /hydrat|mismatch|did not match|Attempting to|non-hydrat/i.test(m.text),
);

// --- Criterion 3b: did the browser issue an RPC for the loader?
const rpcCalls = requests.filter((r) => r.url.includes("/_server"));

// --- Criterion 4: client-side navigation without a document reload
await evalJs(`window.__spaMarker = "alive"`);
await evalJs(`document.querySelector('a[href="/about"]').click()`);
await sleep(1500);
const afterNav = await evalJs(`
  ({ path: location.pathname,
     marker: window.__spaMarker ?? null,
     heading: document.querySelector("h1")?.textContent ?? null })
`);

const results = [
  ["1. loader data present in server HTML", ssrPayloadId !== null && renderedId !== null],
  ["2. no hydration mismatch warnings", hydrationWarnings.length === 0],
  ["3. no loader refetch (SSR id === rendered id)", ssrPayloadId === renderedId],
  ["3b. no /_server RPC issued by browser", rpcCalls.length === 0],
  ["4. client-side nav, no document reload", afterNav.path === "/about" && afterNav.marker === "alive"],
];

console.log("\n──────── Phase 0 exit criteria ────────");
for (const [label, ok] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
console.log("───────────────────────────────────────");
console.log("ssr payload id :", ssrPayloadId);
console.log("rendered id    :", renderedId);
console.log("/_server calls :", rpcCalls.length, rpcCalls.map((r) => r.method).join(","));
console.log("after nav      :", JSON.stringify(afterNav));
if (hydrationWarnings.length) console.log("hydration warnings:", hydrationWarnings);
const errors = consoleMsgs.filter((m) => m.level === "error");
if (errors.length) console.log("console errors :", errors.slice(0, 5));

ws.close();
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
