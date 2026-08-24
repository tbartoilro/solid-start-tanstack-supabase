import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { Box, Grid, HStack } from "styled-system/jsx";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";

/**
 * Layout primitives for the list screens.
 *
 * They exist because six screens were each solving the same three problems
 * their own way, which is how a filter row ends up a different height on every
 * page. Anything here is a decision made once: control density, how a table
 * behaves when it outgrows the viewport, and what pagination looks like.
 */

/**
 * Horizontal scroll container for a table.
 *
 * A table with five columns cannot be made to fit a 390px phone by shrinking
 * it — the cells just wrap into unreadable stacks. Letting it keep an honest
 * minimum width and scroll sideways preserves the row as a readable unit, and
 * `minW` is what forces that rather than allowing the squeeze.
 *
 * The scroll container is the Card body, so the table's own borders still line
 * up with the card edge.
 */
export function TableScroll(props: { minW?: string; children: JSX.Element }) {
  return (
    <Box
      overflowX="auto"
      // Keeps the horizontal scrollbar from overlapping the last row on
      // platforms that render one persistently.
      css={{ "&::-webkit-scrollbar": { height: "0.5rem" } }}
    >
      <Box minW={props.minW ?? "44rem"}>{props.children}</Box>
    </Box>
  );
}

/**
 * Filter controls laid out on a symmetric grid.
 *
 * Previously these were a flex row where the search box grew and the select had
 * a hard-coded width, so the two never lined up and the row looked accidental.
 * A grid gives every control the same width at every breakpoint: one per row on
 * a phone, two side by side from `sm`, three from `xl`.
 */
export function FilterBar(props: { children: JSX.Element }) {
  return (
    <Grid columns={{ base: 1, sm: 2, xl: 3 }} gap="3" alignItems="end">
      {props.children}
    </Grid>
  );
}

/**
 * Pagination footer.
 *
 * On a phone the page counter sits above the buttons rather than between them,
 * which is what stops "Page 1 of 1 · 16 issues" from squeezing the two buttons
 * into slivers.
 */
export function Pagination(props: {
  page: number;
  totalPages: number;
  summary?: JSX.Element;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <Grid
      gridTemplateColumns={{ base: "1fr", sm: "auto 1fr auto" }}
      gap="3"
      alignItems="center"
      justifyItems={{ base: "stretch", sm: "center" }}
      p="3"
      borderTopWidth="1px"
      borderColor="border.default"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={props.page <= 1}
        onClick={props.onPrevious}
        gridRow={{ base: 2, sm: "auto" }}
        gridColumn={{ base: 1, sm: 1 }}
      >
        Previous
      </Button>

      <Text
        fontSize="sm"
        color="fg.muted"
        textAlign="center"
        gridRow={{ base: 1, sm: "auto" }}
        gridColumn={{ base: 1, sm: 2 }}
      >
        <Show when={props.summary} fallback={`Page ${props.page} of ${props.totalPages}`}>
          {props.summary}
        </Show>
      </Text>

      <Button
        variant="outline"
        size="sm"
        disabled={props.page >= props.totalPages}
        onClick={props.onNext}
        gridRow={{ base: 3, sm: "auto" }}
        gridColumn={{ base: 1, sm: 3 }}
      >
        Next
      </Button>
    </Grid>
  );
}

/**
 * Inline "create one of these" form above a list.
 *
 * Same reasoning as FilterBar: the fields stack on a phone and share a row on a
 * wider screen, and the submit button goes full width when stacked so it is not
 * a lone small target on the left.
 */
export function CreateBar(props: { children: JSX.Element; action: JSX.Element }) {
  return (
    <Grid
      gridTemplateColumns={{ base: "1fr", md: "1fr auto" }}
      gap="3"
      alignItems="end"
    >
      <Grid columns={{ base: 1, sm: 2 }} gap="3" alignItems="end">
        {props.children}
      </Grid>
      <HStack justifyContent={{ base: "stretch", md: "flex-end" }}>{props.action}</HStack>
    </Grid>
  );
}
