import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/solid-router";
import { createMemo, createSignal, Show } from "solid-js";
import { Stack } from "styled-system/jsx";
import { CenteredCard, ErrorBanner } from "~/components/page";
import { Button } from "~/components/ui/button";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { slugify } from "~/lib/slug";
import { createOrganization } from "~/server/rpc/org";

export const Route = createFileRoute("/new-org")({
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: "/login" });
  },
  component: NewOrgPage,
});

function NewOrgPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  const slug = createMemo(() => slugify(name()));

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const org = await createOrganization({ name: name() });

      // The server refreshed the access token so the new membership is in the
      // `orgs` claim; the cached session still predates it, so drop it and let
      // the root route refetch before we navigate into the org.
      queryClient.removeQueries({ queryKey: ["session"] });
      await router.invalidate();

      await router.navigate({ to: "/$orgSlug", params: { orgSlug: org.slug } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the organization.");
    } finally {
      setPending(false);
    }
  }

  return (
    <CenteredCard title="Create an organization" description="You will be its owner.">
      <form onSubmit={onSubmit}>
        <Stack gap="4">
          <Field.Root required>
            <Field.Label>Organization name</Field.Label>
            <Input
              type="text"
              required
              maxLength={100}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
            <Show when={slug()}>
              <Field.HelperText>
                URL: <code>/{slug()}</code>
              </Field.HelperText>
            </Show>
          </Field.Root>

          <ErrorBanner message={error()} />

          <Button
            type="submit"
            loading={pending()}
            loadingText="Creating…"
            disabled={!slug()}
            width="full"
          >
            Create organization
          </Button>

          <Text fontSize="sm" color="fg.muted" textAlign="center">
            <Link to="/select-org">Back to organizations</Link>
          </Text>
        </Stack>
      </form>
    </CenteredCard>
  );
}
