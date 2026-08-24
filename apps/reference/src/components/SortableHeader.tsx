import type { CellLayout, SortDir, SortExpr } from "@orgadmin/core";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-solid";
import { Show } from "solid-js";
import { Button } from "~/components/ui/button";
import * as Table from "~/components/ui/table";
import type { TableCellProps } from "~/resources/registry";

/**
 * A column header that can sort, driven by a descriptor column.
 *
 * Two accessibility decisions worth keeping.
 *
 * The control is a real `<button>` rather than a click handler on the `<th>`.
 * A cell is not focusable and is not announced as pressable, so a click handler
 * there is unreachable by keyboard and invisible to assistive technology.
 *
 * The current state goes on the `<th>` as `aria-sort`, which is the attribute
 * screen readers actually announce for this. Keeping it off the button leaves
 * the button's accessible name as the plain column label — so the locators the
 * e2e suite already uses keep matching, and the name does not churn as the sort
 * changes.
 *
 * An `actions` column has no header text by design: its `<th>` is empty so the
 * buttons underneath get no column heading of their own.
 */

export interface SortableHeaderColumn {
  readonly id: string;
  readonly label: string;
  readonly layout?: CellLayout;
  readonly sortBy?: SortExpr | readonly SortExpr[];
  readonly sortDescFirst?: boolean;
  readonly hidden?: boolean;
  readonly headerProps?: TableCellProps;
}

export function SortableHeader(props: {
  column: SortableHeaderColumn;
  sort: () => string;
  dir: () => SortDir;
  onSort: (next: { column: string; dir: SortDir }) => void;
}) {
  const active = () => props.sort() === props.column.id;
  const sortable = () => props.column.sortBy !== undefined;

  const ariaSort = (): "ascending" | "descending" | "none" | undefined => {
    if (!sortable()) return undefined;
    if (!active()) return "none";
    return props.dir() === "asc" ? "ascending" : "descending";
  };

  /*
   * Clicking the active column flips it; clicking a new one starts from the
   * direction that column reads best in. Dates and severities want the high
   * end first — "newest" and "most urgent" are what someone is looking for —
   * while names want A-Z.
   */
  const next = (): SortDir => {
    if (active()) return props.dir() === "asc" ? "desc" : "asc";
    return props.column.sortDescFirst ? "desc" : "asc";
  };

  return (
    <Show when={!props.column.hidden}>
      <Table.Header {...(props.column.headerProps ?? {})} aria-sort={ariaSort()}>
        <Show when={sortable()} fallback={props.column.label}>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            px="1"
            // Inherited so a sortable header is typographically identical to a
            // plain one — the control should not announce itself by looking
            // different from its neighbours.
            fontWeight="inherit"
            fontSize="inherit"
            color="inherit"
            gap="1"
            onClick={() => props.onSort({ column: props.column.id, dir: next() })}
          >
            {props.column.label}
            <Show
              when={active()}
              fallback={<ChevronsUpDown size={12} opacity={0.4} aria-hidden="true" />}
            >
              <Show
                when={props.dir() === "asc"}
                fallback={<ArrowDown size={12} aria-hidden="true" />}
              >
                <ArrowUp size={12} aria-hidden="true" />
              </Show>
            </Show>
          </Button>
        </Show>
      </Table.Header>
    </Show>
  );
}
