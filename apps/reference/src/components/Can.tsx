import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { can, type AppPermission, type Session } from "~/lib/auth";

/**
 * Renders `children` only when the session grants `permission` in `orgId`.
 *
 * ⚠ This hides UI. It does not protect anything. The permission list it reads
 * was resolved when the session was fetched, so it can be stale — and in any
 * case the user can simply call the endpoint directly. Every action wrapped in
 * a `<Can>` must independently enforce the same permission on the server.
 *
 * Its real job is to stop the interface offering people buttons that would fail.
 */
export function Can(props: {
  session: Session | null | undefined;
  orgId: string | null | undefined;
  permission: AppPermission;
  fallback?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <Show when={can(props.session, props.orgId, props.permission)} fallback={props.fallback}>
      {props.children}
    </Show>
  );
}
