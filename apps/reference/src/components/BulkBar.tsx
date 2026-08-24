import type { BulkOutcome } from "@orgadmin/core";
import type { RowSelectionState } from "@tanstack/solid-table";
import { createSignal, Show, type JSX } from "solid-js";
import { HStack } from "styled-system/jsx";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";

/**
 * The bar that appears once rows are selected.
 *
 * Selection lives above the table and is keyed by row id, so it survives paging
 * and filtering — you can select three issues on page 1, two more on page 4 and
 * act on all five. That is the point of bulk on a list this long, and it is why
 * the count here comes from the selection map rather than from the rows on
 * screen.
 *
 * It also means most of the selection is usually invisible. The bar therefore
 * always states the number and offers Clear, because a stale selection you
 * cannot see is the failure mode of this pattern.
 */

export interface BulkBarProps {
  selection: () => RowSelectionState;
  onClear: () => void;
  /** Plural noun for the count: "issues", "members". */
  noun: string;
  children: (ids: string[]) => JSX.Element;
}

/** Selected ids, in insertion order. */
export function selectedIds(selection: RowSelectionState): string[] {
  return Object.keys(selection).filter((id) => selection[id]);
}

export function BulkBar(props: BulkBarProps) {
  const ids = () => selectedIds(props.selection());

  return (
    <Show when={ids().length > 0}>
      <HStack
        gap="3"
        px="4"
        py="3"
        flexWrap="wrap"
        borderBottomWidth="1px"
        borderColor="border.default"
        bg="bg.subtle"
        // Sticky so the bar stays reachable while scrolling a long list: the
        // rows you selected earlier are usually off-screen by the time you
        // decide what to do with them.
        position="sticky"
        top="0"
        zIndex="1"
        role="region"
        aria-label="Bulk actions"
      >
        <Text fontSize="sm" fontWeight="medium">
          {ids().length} {ids().length === 1 ? props.noun.replace(/s$/, "") : props.noun} selected
        </Text>
        <HStack gap="2" flexWrap="wrap" ms="auto">
          {props.children(ids())}
          <Button type="button" variant="ghost" size="sm" onClick={props.onClear}>
            Clear
          </Button>
        </HStack>
      </HStack>
    </Show>
  );
}

/**
 * Turns a set of per-row outcomes into one sentence.
 *
 * Bulk operations partially succeed, and this is where that has to be told
 * honestly. Removing five members can refuse on one for being your own account
 * and on another for being the last owner while the other three go through —
 * reporting either "done" or "failed" would be a lie about three rows.
 *
 * Returns null when everything succeeded, so the caller can stay silent on the
 * happy path rather than announcing the obvious.
 */
export function describeOutcomes(outcomes: readonly BulkOutcome[], noun: string): string | null {
  const failed = outcomes.filter((o) => !o.ok);
  if (failed.length === 0) return null;

  const succeeded = outcomes.length - failed.length;
  // The distinct reasons, not one per row: five refusals for the same reason
  // are one thing to tell someone, not five.
  const reasons = [...new Set(failed.map((o) => o.error).filter(Boolean))];

  const head =
    succeeded > 0
      ? `${succeeded} of ${outcomes.length} ${noun} updated. ${failed.length} refused`
      : `None of the ${outcomes.length} selected ${noun} could be updated`;

  return `${head}: ${reasons.join(" ")}`;
}
