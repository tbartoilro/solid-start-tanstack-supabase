import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Deliberately does NOT load the SolidStart plugin.
 *
 * These are unit tests for pure logic — the permission matrix and the
 * escalation rules — which must run without a server, a database or a browser.
 * Anything that needs those is covered by the integration suites in scripts/.
 */
export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
