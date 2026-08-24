import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { Box, HStack, Stack } from "styled-system/jsx";
import * as Alert from "~/components/ui/alert";
import * as Card from "~/components/ui/card";
import { Heading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";
import { PageTitle } from "./title";

/**
 * Page-level furniture shared by every screen.
 *
 * These exist so a screen file is about its own behaviour rather than about
 * spacing. Anything used on three or more screens belongs here; anything used
 * once stays inline where it can be read alongside the thing it styles.
 */

export function PageHeader(props: {
  title: string;
  description?: JSX.Element;
  actions?: JSX.Element;
}) {
  return (
    <HStack justifyContent="space-between" alignItems="flex-start" gap="4" mb="6" flexWrap="wrap">
      <PageTitle title={props.title} />
      {/*
        The title is data on some screens — a project name — so it can be a
        single unbroken token. A flex item defaults to `min-width: auto`, and
        overflowing text still counts towards the viewport's scrollable area,
        so both halves are needed: `minW="0"` lets the column shrink, and
        `anywhere` lets the word itself break. Without them one badly named
        project scrolls the whole document sideways on a phone.
      */}
      <Stack gap="1" minW="0">
        <Heading as="h1" size="2xl" overflowWrap="anywhere">
          {props.title}
        </Heading>
        <Show when={props.description}>
          <Text color="fg.muted" overflowWrap="anywhere">
            {props.description}
          </Text>
        </Show>
      </Stack>
      <Show when={props.actions}>
        <HStack gap="2">{props.actions}</HStack>
      </Show>
    </HStack>
  );
}

/**
 * A labelled number. Deliberately not a chart — these are single values.
 *
 * Sized down on small screens so three fit across a phone. At the previous
 * fixed size they stacked into three full-width cards and pushed the actual
 * content below the fold.
 */
export function StatTile(props: { label: string; value: JSX.Element }) {
  return (
    <Card.Root>
      <Card.Body gap="0.5" py={{ base: "3", md: "4" }} px={{ base: "3", md: "6" }}>
        <Text fontSize={{ base: "2xl", md: "3xl" }} fontWeight="semibold" lineHeight="1.1">
          {props.value}
        </Text>
        <Text fontSize="xs" color="fg.muted" lineHeight="1.3">
          {props.label}
        </Text>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * Error banner for a failed action.
 *
 * `role="alert"` matters: a message that appears after a button press is
 * useless to a screen reader if nothing announces it.
 */
export function ErrorBanner(props: { message: string | null | undefined }) {
  return (
    <Show when={props.message}>
      <Alert.Root role="alert" mb="4">
        <Alert.Content>
          <Alert.Description>{props.message}</Alert.Description>
        </Alert.Content>
      </Alert.Root>
    </Show>
  );
}

/** Confirmation of a completed action. Also announced. */
export function SuccessBanner(props: { message: string | null | undefined }) {
  return (
    <Show when={props.message}>
      <Alert.Root role="status" mb="4" colorPalette="green">
        <Alert.Content>
          <Alert.Description>{props.message}</Alert.Description>
        </Alert.Content>
      </Alert.Root>
    </Show>
  );
}

/** Shown in place of a table or list that has nothing in it. */
export function EmptyState(props: { title: string; description?: string; action?: JSX.Element }) {
  return (
    <Box py="10" textAlign="center">
      <Stack gap="2" alignItems="center">
        <Text fontWeight="medium">{props.title}</Text>
        <Show when={props.description}>
          <Text fontSize="sm" color="fg.muted" maxW="24rem">
            {props.description}
          </Text>
        </Show>
        <Show when={props.action}>
          <Box pt="2">{props.action}</Box>
        </Show>
      </Stack>
    </Box>
  );
}

/** Centred single-card layout for the signed-out and onboarding screens. */
export function CenteredCard(props: { title: string; description?: JSX.Element; children: JSX.Element }) {
  return (
    <Box
      minH="100dvh"
      display="grid"
      placeItems="center"
      p="4"
      bg="bg.canvas"
    >
      <PageTitle title={props.title} />
      <Card.Root width="full" maxW="26rem">
        <Card.Header>
          <Card.Title>{props.title}</Card.Title>
          <Show when={props.description}>
            <Card.Description>{props.description}</Card.Description>
          </Show>
        </Card.Header>
        <Card.Body>{props.children}</Card.Body>
      </Card.Root>
    </Box>
  );
}
