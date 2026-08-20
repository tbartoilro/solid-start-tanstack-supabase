/// <reference types="@solidjs/start/env" />

import type { createRouter } from "./router";
import type { RequestAuth } from "./server/context";
import type { Db } from "./server/supabase";

declare global {
  namespace App {
    interface RequestEventLocals {
      /** Per-request TanStack Router instance, created in `entry-server.tsx`. */
      router: ReturnType<typeof createRouter>;
      /** Correlation id assigned by `src/middleware.ts`. */
      requestId: string;
      /** Per-request CSP nonce, applied to the client entry script. */
      nonce: string;
      /** Request-scoped Supabase client acting as the signed-in user. */
      supabase: Db;
      /** Verified identity, or null when the request is anonymous. */
      auth: RequestAuth | null;
      /** Tenant this request is acting within, validated against membership. */
      activeOrgId: string | null;
    }
  }
}

export {};
