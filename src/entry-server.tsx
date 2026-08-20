// @refresh reload
import { createHandler, StartServer, type FetchEvent } from "@solidjs/start/server";
import { dehydrate } from "@tanstack/solid-query";
import { createMemoryHistory } from "@tanstack/solid-router";
import { getRequestEvent } from "solid-js/web";
import { createRouter, getQueryClient, QUERY_STATE_ID } from "./router";

/**
 * The SolidStart <-> TanStack Router seam.
 *
 * `createHandler`'s third argument runs after middleware but before the page
 * event is created and before render. That ordering is what makes this whole
 * architecture work:
 *
 *   1. middleware populates `event.locals` (session, active org)
 *   2. routerLoad  <- we are here: match the route and run its loaders
 *   3. render      <- `app.tsx` reads the already-loaded router
 *
 * Because loaders run at step 2, anything they fetch is present in the very
 * first byte of HTML rather than arriving after hydration.
 */
const routerLoad = async (event: FetchEvent) => {
  const url = new URL(event.request.url);

  const router = createRouter();
  event.locals.router = router;

  router.update({
    history: createMemoryHistory({ initialEntries: [url.href.replace(url.origin, "")] }),
    // `context` is required by `update`; re-passing the existing one keeps the
    // QueryClient created in `createRouter` rather than replacing it.
    context: router.options.context,
  });

  await router.load();
};

/**
 * Serializes the query cache that `routerLoad` just populated.
 *
 * SolidStart owns the document and TanStack Router's own SSR payload mechanism
 * is not in play here, so the loader results would otherwise be stranded on the
 * server and every loader would run a second time on hydration. Inlining the
 * dehydrated cache is what carries them across.
 *
 * `<` is escaped so a value containing `</script>` cannot break out of the tag.
 */
function QueryState() {
  const router = getRequestEvent()?.locals.router;
  if (!router) return null;

  const payload = JSON.stringify(dehydrate(getQueryClient(router))).replace(/</g, "\\u003c");

  // `type="application/json"` is a data block, not executed, so CSP script-src
  // does not gate it — but the nonce is carried anyway so the tag stays valid
  // under stricter policies and older implementations.
  return (
    <script
      id={QUERY_STATE_ID}
      type="application/json"
      nonce={getRequestEvent()?.locals.nonce}
      innerHTML={payload}
    />
  );
}

export default createHandler(
  () => (
    <StartServer
      document={({ assets, children, scripts }) => (
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
            {assets}
          </head>
          <body>
            <div id="app">{children}</div>
            <QueryState />
            {scripts}
          </body>
        </html>
      )}
    />
  ),
  // Hands SolidStart the nonce minted in middleware, so the client entry script
  // it injects carries `nonce="..."` and satisfies the strict CSP set alongside
  // it. Without this the production policy would block the app's own bootstrap.
  (event) => ({ nonce: event.locals.nonce }),
  routerLoad,
);
