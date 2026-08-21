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
    env: {
      // services/members.ts imports src/server/email.ts, which imports the
      // server env schema — and that schema validates at module load, on
      // purpose, so a missing variable fails at boot rather than mid-request.
      // Importing it from a test therefore needs the variable to exist. These
      // tests still reach no network and no database; this only satisfies the
      // boot check. The VITE_* half comes from .env, which is why CI has to
      // `cp .env.example .env` before running the suite.
      SUPABASE_SECRET_KEY: "test-only-never-used",
    },
  },
});
