import type { CellLayout, ResourceDescriptor, SortDir } from "@orgadmin/core";
import {
  createSolidTable,
  getCoreRowModel,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type Table as TableInstance,
} from "@tanstack/solid-table";
import { createMemo, For, Show, type JSX } from "solid-js";
import { ResponsiveTable } from "~/components/data";
import { SortableHeader } from "~/components/SortableHeader";
import * as Checkbox from "~/components/ui/checkbox";
import * as Table from "~/components/ui/table";
import type { TableCellProps } from "~/resources/registry";

/**
 * Renders any resource descriptor as a table.
 *
 * TanStack Table is headless: it owns row identity, the selection state machine
 * and the sort toggle, and renders nothing. So the markup here stays the Park UI
 * markup the screens already used, and the table instance drives it. That is
 * what keeps the responsive card contract intact — the CSS below `lg` keys off
 * `data-*` attributes on each cell, and those still come from the descriptor.
 *
 * Two things in here look like style choices and are not. Both were verified
 * against the installed library source, and both fail silently if changed.
 */

/** Reserved column id for the selection checkbox. Not a descriptor column. */
const SELECT_COLUMN = "__select";

export interface DataTableSort {
  column: string;
  dir: SortDir;
}

export interface DataTableProps<TRow, TCtx> {
  descriptor: ResourceDescriptor<TRow, TCtx, TableCellProps>;
  /**
   * Accessors, not values. This component does not remount when only the org
   * slug changes, so a snapshot would leave it rendering the previous tenant —
   * the same rule the route components follow for `useRouteContext`.
   */
  rows: () => readonly TRow[] | undefined;
  context: () => TCtx;
  sort: () => DataTableSort;
  onSortChange: (next: DataTableSort) => void;
  /** Omit for a table with no checkbox column at all. */
  selection?: {
    value: () => RowSelectionState;
    onChange: (next: RowSelectionState) => void;
  };
  size?: "sm" | "md";
}

export function DataTable<TRow, TCtx>(props: DataTableProps<TRow, TCtx>): JSX.Element {
  const descriptor = () => props.descriptor;
  const visible = createMemo(() => descriptor().columns.filter((c) => !c.hidden));

  const columns = createMemo<ColumnDef<TRow>[]>(() => [
    ...(props.selection ? [{ id: SELECT_COLUMN, enableSorting: false } as ColumnDef<TRow>] : []),
    ...visible().map((column) => ({
      id: column.id,
      header: column.label,
      enableSorting: column.sortBy !== undefined,
      sortDescFirst: column.sortDescFirst ?? false,
      meta: { column },
    })),
  ]);

  const table = createSolidTable<TRow>({
    /*
     * Getters, not values — and this is load-bearing rather than stylistic.
     *
     * createSolidTable puts its options through mergeProps, which preserves a
     * getter as an accessor. The row model then invokes that accessor inside
     * the JSX's reactive scope, which is the only thing that subscribes the
     * table to the signal. Passing `data: props.rows()` instead stores a plain
     * value: the array is read once when this object literal is evaluated, the
     * dependency check never sees a new reference, and the table silently never
     * updates again. There is no warning for it.
     */
    get data() {
      return (props.rows() ?? []) as TRow[];
    },
    get columns() {
      return columns();
    },
    get state() {
      const current = props.sort();
      return {
        sorting: [{ id: current.column, desc: current.dir === "desc" }] satisfies SortingState,
        rowSelection: props.selection?.value() ?? {},
      };
    },
    getCoreRowModel: getCoreRowModel(),

    // Selection is keyed by this, which is what lets it survive paging: the
    // state is a plain id map and nothing prunes ids absent from the loaded page.
    getRowId: (row) => descriptor().rowId(row),

    // The server sorts, filters and pages. Doing any of it here would act on
    // the loaded page alone — which looks right and is wrong, and is exactly
    // the truncation bug this codebase has already paid for twice.
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,

    // A list always has an order; "unsorted" is not a state the server can
    // serve, so the header cycles asc/desc rather than asc/desc/none.
    enableSortingRemoval: false,

    enableRowSelection: !!props.selection,
    enableMultiRowSelection: true,

    onSortingChange: (updater) => {
      const current = props.sort();
      const previous: SortingState = [{ id: current.column, desc: current.dir === "desc" }];
      const next = typeof updater === "function" ? updater(previous) : updater;
      const first = next[0] ?? previous[0]!;
      props.onSortChange({ column: first.id, dir: first.desc ? "desc" : "asc" });
    },

    onRowSelectionChange: (updater) => {
      const current = props.selection?.value() ?? {};
      props.selection?.onChange(typeof updater === "function" ? updater(current) : updater);
    },
  });

  return (
    <ResponsiveTable>
      <Table.Root size={props.size ?? "sm"}>
        <Table.Head>
          <Table.Row>
            <Show when={props.selection}>
              <SelectAllHeader table={table} />
            </Show>
            <For each={visible()}>
              {(column) => (
                <SortableHeader
                  column={column}
                  sort={() => props.sort().column}
                  dir={() => props.sort().dir}
                  onSort={props.onSortChange}
                />
              )}
            </For>
          </Table.Row>
        </Table.Head>

        <Table.Body>
          <For each={table.getRowModel().rows}>
            {(row) => (
              <Table.Row>
                <Show when={props.selection}>
                  <SelectCell
                    checked={row.getIsSelected()}
                    disabled={!row.getCanSelect()}
                    label={descriptor().rowLabel(row.original)}
                    onChange={() => row.toggleSelected()}
                  />
                </Show>
                <For each={visible()}>
                  {(column) => (
                    /*
                      Every cell is emitted even when it renders nothing: a row
                      with fewer cells than its header row is not a valid table.
                      `td:empty` is what hides a gated action cell below `lg`,
                      so the children stay a single expression — adding
                      whitespace or a wrapper would defeat that selector.

                      Deliberately NOT flexRender. That routes through solid's
                      createComponent, which runs the component body inside
                      untrack, so a cell reading `props.context()` in its body
                      would register no subscription and go stale on an org
                      switch — the same failure the accessor-not-destructured
                      rule exists to prevent, and just as silent. Calling the
                      descriptor's renderer here puts every read inside this
                      expression container's own effect instead.
                    */
                    <Table.Cell
                      {...bucketFor(column.layout, column.label)}
                      {...(column.cellProps ?? {})}
                    >
                      {renderCell(column, row.original, props.context())}
                    </Table.Cell>
                  )}
                </For>
              </Table.Row>
            )}
          </For>
        </Table.Body>
      </Table.Root>
    </ResponsiveTable>
  );
}

/**
 * Exactly one `data-*` bucket per cell.
 *
 * Below `lg` these drive the card layout: the label is written by a `::before`
 * reading `attr(data-label)`, the primary cell is hoisted with `order: -1`, and
 * actions sink to the bottom. A cell carrying none of them renders as an
 * unlabelled orphan line, which the responsive suite fails the build for.
 */
function bucketFor(layout: CellLayout | undefined, label: string): Record<string, unknown> {
  switch (layout ?? "label") {
    case "primary":
      return { "data-primary": true };
    case "actions":
      return { "data-actions": true };
    // Both attributes: the CSS selector is `td[data-label][data-block]`, so
    // `data-block` alone matches nothing.
    case "block":
      return { "data-label": label, "data-block": true };
    default:
      return { "data-label": label };
  }
}

type AnyColumn<TRow, TCtx> = ResourceDescriptor<TRow, TCtx, TableCellProps>["columns"][number];

function renderCell<TRow, TCtx>(column: AnyColumn<TRow, TCtx>, row: TRow, ctx: TCtx): JSX.Element {
  const gate = column.visible ? column.visible(row, ctx) : true;
  if (gate === false) return (column.fallback?.(row, ctx) ?? null) as JSX.Element;
  return (column.cell?.(row, ctx, { disabled: gate === "disabled" }) ?? null) as JSX.Element;
}

/**
 * The selection cell.
 *
 * `data-select` is its own bucket rather than reusing `data-label`. A label
 * would print the word "Select" beside a checkbox whose accessible name already
 * says it, and the label grid reserves a 5rem gutter that a 16px control does
 * not want. It also needs `order: -2` so the checkbox leads its card — above
 * the identifying cell at `order: -1` — which no existing bucket provides.
 *
 * The accessible name is an `aria-label` on the input, never a visually hidden
 * `<span>`. Hidden text is still text content, and the responsive suite fails
 * any body cell that has text but none of the labelling attributes. An
 * aria-label gives the identical accessible name with no text node.
 */
function SelectCell(props: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <Table.Cell data-select width="1%" whiteSpace="nowrap">
      <Checkbox.Root
        size="sm"
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={props.onChange}
      >
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        {/* No Checkbox.Label: it would be text content in the cell. */}
        <Checkbox.HiddenInput aria-label={`Select ${props.label}`} />
      </Checkbox.Root>
    </Table.Cell>
  );
}

function SelectAllHeader<TRow>(props: { table: TableInstance<TRow> }) {
  return (
    <Table.Header width="1%" whiteSpace="nowrap">
      <Checkbox.Root
        size="sm"
        checked={
          props.table.getIsAllPageRowsSelected()
            ? true
            : props.table.getIsSomePageRowsSelected()
              ? "indeterminate"
              : false
        }
        /*
          Page rows, not all rows. Under manual pagination `toggleAllRowsSelected`
          also means "the loaded page", but its name says otherwise and it would
          become wrong the moment anything loads more than a page at once.
        */
        onCheckedChange={(details) => props.table.toggleAllPageRowsSelected(!!details.checked)}
      >
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        <Checkbox.HiddenInput aria-label="Select all rows on this page" />
      </Checkbox.Root>
    </Table.Header>
  );
}
