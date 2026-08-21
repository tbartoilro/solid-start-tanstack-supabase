import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite.
 *
 * Replaces scripts/verify-app.mjs and scripts/verify-ssr.mjs, which drove Chrome
 * DevTools Protocol by hand — opening targets, subscribing to
 * Runtime.consoleAPICalled, tracking Network.requestWillBeSent — about 400 lines
 * of harness before the first assertion. The assertions themselves were also
 * substring matches against raw HTML, so they broke whenever markup moved.
 *
 * scripts/verify-rbac.mjs is deliberately kept: it asserts against PostgREST
 * with the application switched off entirely, which is a different and valuable
 * claim that a browser test cannot make.
 *
 * On NixOS the bundled Chromium builds are generic Linux binaries that will not
 * start, so `channel: "chromium"` points Playwright at the Nix-provided browser
 * (see shell.nix). CHROMIUM_PATH overrides it where that is wrong.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  // The suite runs against a Vite *dev* server, because the direct-RPC tests
  // import server modules by source path — the check that a route guard is not
  // the thing protecting an endpoint. Dev mode means the first hit on any route
  // pays for an on-demand SSR compile, which on a cold CI runner comfortably
  // exceeds Playwright's 5s default. Raised rather than papered over with
  // waitForTimeout calls.
  expect: { timeout: process.env.CI ? 20_000 : 8_000 },
  timeout: process.env.CI ? 90_000 : 45_000,

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3010",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
    },
  },

  projects: [
    // Signs each role in once; see e2e/auth.setup.ts for why this matters.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],

  // Reuses an already-running dev server locally; starts one in CI.
  //
  // --host 127.0.0.1 is not optional: vite otherwise binds IPv6 loopback only
  // ([::1]:3010), and the readiness probe below never connects.
  webServer: {
    command: "npx vite dev --port 3010 --host 127.0.0.1",
    url: "http://127.0.0.1:3010/login",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
