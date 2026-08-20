/// <reference types="@solidjs/start/env" />

import type { createRouter } from "./router";

declare global {
  namespace App {
    interface RequestEventLocals {
      /** Per-request TanStack Router instance, created in `entry-server.tsx`. */
      router: ReturnType<typeof createRouter>;
      /** Correlation id assigned by `src/middleware.ts`. */
      requestId: string;
    }
  }
}

export {};
