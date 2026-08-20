import { queryOptions, useQuery } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";

/**
 * Phase 0 instrumentation.
 *
 * `"use server"` compiles to an in-process call during SSR and to an RPC over
 * the network from the browser. The random `id` is the double-fetch detector:
 * if the id shown in the browser matches the one in the server-rendered HTML,
 * the loader result crossed the wire as data. If it differs, the client re-ran
 * the loader and we paid for the same work twice.
 */
const getSpikeData = async () => {
  "use server";
  const payload = {
    id: crypto.randomUUID().slice(0, 8),
    at: new Date().toISOString(),
  };
  console.log(`[spike] loader executed on server -> ${payload.id}`);
  return payload;
};

const spikeQuery = () =>
  queryOptions({
    queryKey: ["spike"],
    queryFn: () => getSpikeData(),
  });

export const Route = createFileRoute("/")({
  // `ensureQueryData` is what makes the transfer work: on the server it fetches
  // and fills the cache, on the client it finds the hydrated entry and returns
  // it without touching the network.
  loader: ({ context }) => context.queryClient.ensureQueryData(spikeQuery()),
  component: Home,
});

function Home() {
  const query = useQuery(spikeQuery);

  return (
    <main>
      <h1>SSR seam spike</h1>
      <p>
        loader id: <code id="loader-id">{query.data?.id}</code>
      </p>
      <p>
        produced at: <code>{query.data?.at}</code>
      </p>
    </main>
  );
}
