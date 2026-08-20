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
