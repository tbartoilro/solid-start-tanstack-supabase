import { fileURLToPath } from "node:url";
import { solidStart } from "@solidjs/start/config";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // Pinned so the port is a fact rather than whatever was free. It is also the
  // default PUBLIC_APP_URL in src/server/env.ts, which is what makes invite
  // links generated in development actually resolve.
  //
  // The e2e suite deliberately uses a different port (see playwright.config.ts)
  // so a hand-run dev server and a test run cannot collide.
  server: { port: 4321 },

  // tsconfig `paths` only teaches TypeScript where styled-system lives; Vite
  // resolves modules independently. Without this the build typechecks cleanly
  // and then fails at runtime with "Cannot find module 'styled-system/css'".
  resolve: {
    alias: {
      "styled-system": fileURLToPath(new URL("./styled-system", import.meta.url)),
    },
  },
  plugins: [
    solidStart({
      // SolidStart's own filesystem router is pointed at `src/api` so that it only
      // ever claims HTTP endpoints (auth callbacks, webhooks, health). That leaves
      // `src/routes` entirely to TanStack Router, so the two routers never compete
      // for the same files.
      routeDir: "./api",
      middleware: "src/middleware.ts",
      // SolidStart 2.0.2's dev toolbar imports { SourceMapConsumer } from
      // source-map-js, which is CJS-only and yields no such named export under
      // Vite 8. The resulting SyntaxError aborts the client entry module graph,
      // so the page renders from SSR but never hydrates — forms silently do
      // nothing. Disabling the overlay is dev-only and does not affect builds.
      devOverlay: false,
      serverFunctions: {
        // Sanitizes anything a server function throws before it reaches the
        // client, so internal errors never leak schema or stack details.
        onError: "src/server/on-error.ts",
      },
    }),
    tanstackRouter({ target: "solid" }),
    nitro(),
  ],
});
