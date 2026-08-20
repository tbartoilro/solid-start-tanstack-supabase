import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/about")({
  component: About,
});

function About() {
  return (
    <main>
      <h1>About</h1>
      <p>
        Second route, used to confirm that client-side navigation happens without a
        full document reload.
      </p>
    </main>
  );
}
