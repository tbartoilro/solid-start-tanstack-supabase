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
 * A table that stops being a table on small screens.
 *
 * Sideways scrolling was the previous answer to five columns on a 390px phone.
 * It keeps rows readable but is a poor way to actually use the data: you cannot
 * see a whole record at once, and with many rows you are scrolling in two axes
 * at the same time.
 *
 * Below `lg` each row becomes a card and each cell becomes a `Label  value`
 * line, so the columns that were off-screen simply appear underneath. The
 * header row is hidden because every value now carries its own label.
 *
 * `lg` rather than `md` because the sidebar takes 16rem from `md` up. Between
 * 768px and 1023px that leaves only 450-700px for content, which a five-column
 * table cannot fit — so it kept its width and scrolled inside its own card,
 * which is the same inconvenience on a laptop as it was on a phone.
 *
 * Labels come from `data-label` on each cell. That is deliberately explicit
 * rather than read from the header row: a cell can then say something shorter
 * or clearer than its column heading, and cells that need no label (a row's
 * action buttons) just omit it and span the full width.
 *
 * Note this only changes presentation. The markup stays a real `<table>`, and
 * `src/components/ui/table.tsx` states the ARIA roles so the semantics survive
 * the display change.
 */
export function ResponsiveTable(props: { children: JSX.Element }) {
  return (
    <Box
      // A safety valve, not a layout choice. Nothing should reach it: from `lg`
      // the table is fluid and every column fits, and below `lg` there are no
      // columns to overflow.
      //
      // There used to be a `min-width: 44rem` floor here as well. It was the
      // cause of the scrolling rather than a guard against it — the floor held
      // the table wider than its container, so the container scrolled.
      lg={{ overflowX: "auto" }}
      css={{
        // Everything below is the stacked-card layout, scoped by a max-width
        // condition so the table above `lg` needs no undoing.
        lgDown: {
          "& thead": { display: "none" },
          "& tbody, & td": { display: "block" },

          // A flex column rather than a block, so `order` can lift the
          // identifying cell to the top of the card and push the actions to the
          // bottom no matter where they sit in the column order — which is
          // chosen for the desktop table, not for this.
          "& tr": {
            display: "flex",
            flexDirection: "column",
            borderWidth: "1px",
            borderColor: "border.default",
            rounded: "l2",
            p: "3",
            mb: "3",
            // The table's own row rule would double up with the card border.
            borderBottomWidth: "1px",
          },
          "& tbody": { p: "3" },
          "& tbody tr:last-of-type": { mb: "0" },

          "& td": {
            borderWidth: "0",
            px: "0",
            py: "1",
            // A right-aligned numeric column reads as misaligned once it is a
            // label/value line, so alignment is reset here.
            textAlign: "start",
          },

          // Cells that carry a label become two columns: the label, then the
          // value that used to live under a distant header.
          "& td[data-label]": {
            display: "grid",
            gridTemplateColumns: "minmax(5rem, 40%) 1fr",
            gap: "3",
            alignItems: "baseline",
            // Without this a grid item fills its track, so a badge or a button
            // in the value column stretches to the full card width instead of
            // hugging its own content.
            justifyItems: "start",
          },
          "& td[data-label]::before": {
            content: "attr(data-label)",
            color: "fg.muted",
            fontSize: "xs",
            fontWeight: "medium",
          },

          // A value too long to sit beside its label — a JSON blob, a URL —
          // gets the label on its own line above instead of a 40% gutter it
          // would then have to squeeze into.
          "& td[data-label][data-block]": {
            display: "block",
          },
          "& td[data-label][data-block]::before": {
            display: "block",
            mb: "1",
          },

          // The identifying cell leads the card, so it gets no label and a
          // little more weight than the rest.
          /*
            The selection checkbox governs the whole card, so it leads it —
            above the identifying cell, which sits at order -1. No label and no
            5rem gutter: the control's accessible name already says what it is.
          */
          "& td[data-select]": { order: -2, pb: "2" },

          "& td[data-primary]": {
            order: -1,
            fontWeight: "semibold",
            pb: "2",
          },

          // Action buttons sit on their own line at the end of the card.
          "& td[data-actions]": {
            order: 1,
            pt: "2",
            display: "flex",
            justifyContent: "flex-end",
            gap: "2",
          },
          "& td:empty": { display: "none" },
        },
      }}
    >
      {props.children}
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
