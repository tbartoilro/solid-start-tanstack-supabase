import type { AppPermission } from "~/lib/auth";

/**
 * Narrows the framework's `Permission` type to this app's permission union.
 *
 * `@orgadmin/core` cannot import `AppPermission` — it is derived from this
 * app's generated database types, and core has no dependencies by design. So
 * core declares an interface and the app fills it in, the same way TanStack
 * Router is told about its own route tree. Without this a descriptor's
 * `permission: { read: "issues.raed" }` would be a valid `string` and would
 * fail at runtime as a denied request rather than at compile time as a typo.
 */
declare module "@orgadmin/core" {
  interface ResourceRegistry {
    permission: AppPermission;
  }
}

/**
 * The style props a descriptor may pass through to a cell or header.
 *
 * Deliberately narrow rather than `Record<string, unknown>`: these are the
 * escape hatches the existing tables actually use, and keeping the list short
 * makes it obvious when a column is reaching for layout it should not need.
 * Widen it when a real case appears, not before.
 */
export interface TableCellProps {
  textAlign?: "start" | "center" | "end" | "right";
  whiteSpace?: "nowrap" | "normal";
  overflowWrap?: "anywhere" | "break-word" | "normal";
  color?: string;
  width?: string;
}
