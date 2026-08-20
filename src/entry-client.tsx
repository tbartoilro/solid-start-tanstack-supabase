// @refresh reload
import { mount, StartClientTanstack } from "@solidjs/start/client";
import { hydrateQueryState } from "./router";

// Restore the server's query cache *before* mounting, so the router's loaders
// find the data already present instead of refetching it.
hydrateQueryState();

// `StartClientTanstack` (not `StartClient`) is required: it wraps the app with
// one fewer element so the client tree depth matches what TanStack Router
// rendered on the server. Using the wrong one produces hydration mismatches.
mount(() => <StartClientTanstack />, document.getElementById("app")!);
