import { createEffect } from "solid-js";
import { isServer } from "solid-js/web";

const SUFFIX = "Dashboard";

/**
 * Sets the document title for a route.
 *
 * Client-only on purpose. The SSR document carries a static fallback title
 * (see entry-server.tsx) which is what a crawler or a no-JS visitor sees; this
 * refines it once the route is known. Doing it properly on the server would
 * mean threading a head registry through the router, which is not worth it for
 * an application that is entirely behind a login.
 */
export function PageTitle(props: { title: string }) {
  createEffect(() => {
    if (isServer) return;
    document.title = props.title ? `${props.title} · ${SUFFIX}` : SUFFIX;
  });

  return null;
}
