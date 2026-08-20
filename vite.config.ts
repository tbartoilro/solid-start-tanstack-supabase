import { solidStart } from "@solidjs/start/config";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
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
