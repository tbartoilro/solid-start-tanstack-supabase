/**
 * The resource descriptor: one declaration that a list screen and its server
 * query are both built from.
 *
 * This module is deliberately dependency-free — not merely "no Supabase", but
 * nothing at all, including zod. That is what lets the same descriptor be
 * imported by a browser bundle, a server function, and a codegen CLI without
 * dragging a runtime along. Anything that needs zod belongs in
 * `@orgadmin/server`; anything that needs JSX belongs in the app.
 *
 * The descriptor owns the table's *columns* and the shape of its *query*. It
 * deliberately does not own filter UI, create surfaces, cache-invalidation
 * policy, or anything else on the page. Those are genuinely different on every
 * screen, and pulling them in is how this kind of abstraction ends up worse
 * than the hand-written code it replaced.
 */

/**
 * Extension point for the consuming app, narrowed by declaration merging — the
 * same trick TanStack Table uses for `ColumnMeta`.
 *
 * Core cannot import the app's permission union: it is generated from the app's
 * own database. A bare `string` here would let a typo through silently, which
 * for a permission name is a security-shaped bug. So the app narrows it:
 *
 * ```ts
 * declare module "@orgadmin/core" {
 *   interface ResourceRegistry {
 *     permission: AppPermission;
 *   }
 * }
 * ```
 */
export interface ResourceRegistry {
  permission: string;
}

/** The app's permission union once narrowed, otherwise `string`. */
export type Permission = ResourceRegistry["permission"];

/**
 * Whatever the UI layer renders. Core never inspects it, so it stays `unknown`
 * rather than importing a JSX namespace.
 */
export type CellOutput = unknown;

/**
 * Which bucket a cell occupies in the responsive card layout.
 *
 * Below `lg` the table stops being a table and each row becomes a card. These
 * map to the `data-*` attributes that drive it — see `ResponsiveTable` in the
 * app. A cell with no bucket renders as an unlabelled orphan line, which the
 * responsive test suite fails the build for.
 *
 * - `primary`  the identifying cell. Hoisted to the top of the card, no label.
 *              Exactly one per resource.
 * - `label`    a `Label   value` line. The default.
 * - `block`    label on its own line above the value, for long content.
 * - `actions`  buttons. Sinks to the bottom of the card, right-aligned.
 */
export type CellLayout = "primary" | "label" | "block" | "actions";

export type SortDir = "asc" | "desc";

/**
 * A PostgREST `order=` term, written by whoever authors the descriptor and
 * never taken from a request: `"updated_at"`, or `"projects(key)"` to order a
 * parent row by a to-one embed.
 *
 * The distinction matters. PostgREST serialises this straight into the `order`
 * query parameter, so a value arriving from a client could name an embedded
 * path or smuggle a second column through a comma. `resolveSort` in `./sort`
 * is the only thing that produces these, and it only ever returns values it
 * read back out of a descriptor.
 */
export type SortExpr = string;

/**
 * How a cell renders when the viewer may see it but not use it.
 *
 * The third state exists because there is a real case for it: a member may
 * change other people's roles but not their own, and the control is shown
 * disabled rather than hidden, because hiding it would suggest the permission
 * is missing when it is the target that is disallowed.
 */
export interface CellState {
  readonly disabled: boolean;
}

export interface ResourceColumn<
  TRow,
  TCtx,
  TCellProps extends object = Record<string, unknown>,
> {
  /** Stable identity. Appears in URLs as `?sort=<id>`, so treat it as public API. */
  readonly id: string;
  /** Column header, and the `data-label` text on the card below `lg`. */
  readonly label: string;
  /** Defaults to `"label"`. */
  readonly layout?: CellLayout;

  /**
   * The physical sort target. Absent means this column is not sortable and its
   * header stays plain text.
   *
   * Absent is a real answer, not an oversight. Three kinds of column genuinely
   * cannot be sorted: one reached through a left-joined embed (making the join
   * inner would silently drop rows with nothing on the other side), and one
   * that is an aggregate over an embed, which PostgREST cannot order by at all.
   * Declaring `sortBy` on those ships a clickable header that reorders nothing,
   * which is worse than a header that does not invite the click.
   *
   * An array is a compound sort applied in order, each term taking the
   * requested direction — an issue key is its project's key, then its number.
   */
  readonly sortBy?: SortExpr | readonly SortExpr[];

  /**
   * Sort descending on the first click. Dates, counts and severities read
   * newest/highest-first; names read A–Z. Set it explicitly, because the
   * underlying table library guesses from the value type and the guess is
   * wrong often enough to be surprising.
   */
  readonly sortDescFirst?: boolean;

  /**
   * Sortable but never rendered.
   *
   * Needed because a resource's default sort is frequently a column the screen
   * does not show — issues are ordered by `updated_at` and there is no Updated
   * column. Without this the default sort could not be named in the sortable
   * set at all, and so could not be expressed as a URL the user can link to.
   */
  readonly hidden?: boolean;

  /**
   * The `ilike` target for the resource's text search: `"title"`, or
   * `"profiles.email"` through an `!inner` embed. Absent means this column is
   * not searched.
   */
  readonly searchAs?: string;

  /** Advisory, for the introspection CLI and for formatting defaults. */
  readonly kind?: "text" | "number" | "date" | "enum" | "relation" | "json";

  /**
   * Renders the cell. Receives page-level context as well as the row, because
   * a cell routinely needs something the row does not carry — the current
   * session, the org, the list of assignable members, a mutation callback.
   */
  readonly cell?: (row: TRow, ctx: TCtx, state: CellState) => CellOutput;

  /**
   * Row-aware gating: `true` to render, `false` to fall back, `"disabled"` to
   * render the control inert.
   *
   * A static permission name cannot express the rules that actually occur.
   * "May change this issue's status" is *holds the write permission **or** is
   * this row's assignee* — a predicate over the row, not the caller.
   *
   * A note for whoever reads this next: across the app's existing tables,
   * exactly one column needs this. Everywhere else the domain control gates
   * itself internally, which is strictly better, because the check then sits
   * next to the mutation it guards instead of two files away. This hook exists
   * for *generated* columns, where there is no hand-written component to hold
   * the rule. Do not go hoisting working gates up into descriptors.
   */
  readonly visible?: (row: TRow, ctx: TCtx) => boolean | "disabled";

  /**
   * What a denied cell renders instead. Per-column by necessity: a denied
   * status shows a read-only badge, a denied assignee shows plain text, and
   * denied row actions show nothing at all — which lets the empty cell collapse
   * out of the card entirely.
   */
  readonly fallback?: (row: TRow, ctx: TCtx) => CellOutput;

  /**
   * Passed through to the rendered cell and header. Typed by the app so its
   * style-prop types survive; core only requires that it is an object.
   */
  readonly cellProps?: TCellProps;
  readonly headerProps?: TCellProps;
}

export interface BulkActionSpec<TCtx> {
  readonly id: string;
  /** Takes the selection count, because the label reads "Delete 3 issues". */
  readonly label: (count: number) => string;
  /** `mutate` needs a confirmation step; `download` produces a file. */
  readonly kind: "mutate" | "download";
  /** Checked before the action is offered. Absent means the resource's write permission. */
  readonly permission?: Permission;
  /** Red styling and a confirmation dialog. */
  readonly destructive?: boolean;
  readonly run: (ids: readonly string[], ctx: TCtx) => Promise<void>;
}

/** One row's fate in a bulk action. Bulk operations partially succeed. */
export interface BulkOutcome {
  readonly id: string;
  readonly ok: boolean;
  readonly error?: string;
}

export interface ResourceDescriptor<
  TRow,
  TCtx,
  TCellProps extends object = Record<string, unknown>,
> {
  /** Used in query keys and URLs. */
  readonly name: string;
  /** The physical table, for the server query. */
  readonly table: string;
  readonly title: string;

  /**
   * Identity of a row as the *client* sees it, for selection state.
   *
   * Deliberately separate from `idColumn`: a mapped row does not necessarily
   * expose the primary key under that name. A membership row carries its own
   * id as `membershipId`, because it also carries a `userId` and one bare `id`
   * between them would be ambiguous.
   */
  readonly rowId: (row: TRow) => string;

  /** The physical primary key column, for `in(idColumn, ids)` on the server. */
  readonly idColumn: string;

  /**
   * The primary key's type, which decides how a bulk request validates its ids.
   * Not cosmetic: one table in the app keys on a `bigserial` while every other
   * uses a uuid, so a single shared uuid check would reject every id it sends.
   */
  readonly idType: "uuid" | "bigint";

  /**
   * A human name for one row — an issue key, someone's email. Used for
   * confirmation copy and for per-row accessible names, which is why it is
   * required rather than optional: a table of identically-named checkboxes and
   * Edit buttons is unusable with a screen reader and ambiguous to any test.
   */
  readonly rowLabel: (row: TRow) => string;

  readonly permission: {
    readonly read: Permission;
    readonly write?: Permission;
    readonly delete?: Permission;
  };

  readonly columns: readonly ResourceColumn<TRow, TCtx, TCellProps>[];
  /** Must name a column that has a `sortBy`. Enforced by `assertDescriptor`. */
  readonly defaultSort: { readonly column: string; readonly dir: SortDir };
  readonly pageSize: number;
  /** The PostgREST `select` string, embeds included. */
  readonly select: string;
  /** No writes are possible. */
  readonly readOnly?: boolean;
  readonly bulkActions?: readonly BulkActionSpec<TCtx>[];
}

/**
 * A descriptor's sortable column ids, as a type.
 *
 * This is what makes the allowlist checkable at compile time as well as at
 * runtime: the same union feeds the route's search-param schema and the
 * server's validation, so a `?sort=` value the server would reject is a type
 * error on the client rather than a silent fallback discovered in production.
 *
 * It relies on `defineResource` inferring the descriptor with a `const` type
 * parameter — a column literal that omits `sortBy` does not extend
 * `{ sortBy: unknown }`, because the property is required there.
 */
export type SortableId<D extends { columns: readonly { id: string }[] }> =
  Extract<D["columns"][number], { sortBy: unknown }>["id"];

/** The row type a descriptor describes. */
export type RowOf<D> = D extends ResourceDescriptor<infer TRow, never, never> ? TRow : never;

const SORT_EXPR_RE = /^[a-z_][a-z0-9_]*(\([a-z_][a-z0-9_]*\))?$/;

/** Exported for the server's own tests; the boundary itself is `resolveSort`. */
export { SORT_EXPR_RE };

/**
 * Rejects a malformed descriptor at module load, rather than at first render.
 *
 * Every check here is a mistake that would otherwise surface as a confusing
 * runtime symptom: a card with two bold lines, a sort control that silently
 * does nothing, a page size the server quietly overrides.
 *
 * The `SORT_EXPR_RE` check is a guard against author typos — a comma or a
 * `.desc` accidentally baked into a descriptor. It is *not* the security
 * boundary; that is `resolveSort`, which only ever returns expressions it read
 * out of a descriptor in the first place.
 */
export function assertDescriptor(d: ResourceDescriptor<never, never, never>): void {
  const where = `resource "${d.name}"`;

  const ids = d.columns.map((c) => c.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate !== undefined) {
    throw new Error(`${where}: duplicate column id "${duplicate}".`);
  }

  const primary = d.columns.filter((c) => c.layout === "primary");
  if (primary.length !== 1) {
    throw new Error(
      `${where}: expected exactly one column with layout "primary", found ${primary.length}. ` +
        `It is the cell that identifies a row when the table becomes a list of cards.`,
    );
  }

  const actions = d.columns.filter((c) => c.layout === "actions");
  if (actions.length > 1) {
    throw new Error(`${where}: at most one column may have layout "actions".`);
  }

  const sortableColumn = d.columns.find(
    (c) => c.id === d.defaultSort.column && c.sortBy !== undefined,
  );
  if (!sortableColumn) {
    throw new Error(
      `${where}: defaultSort names "${d.defaultSort.column}", which is not a sortable column. ` +
        `Give that column a sortBy — add hidden: true if the screen does not show it.`,
    );
  }

  for (const column of d.columns) {
    if (column.sortBy === undefined) continue;
    const terms = Array.isArray(column.sortBy) ? column.sortBy : [column.sortBy];
    for (const term of terms) {
      if (!SORT_EXPR_RE.test(term)) {
        throw new Error(
          `${where}, column "${column.id}": sortBy "${term}" is not a bare column or ` +
            `to-one embed. Expected something like "updated_at" or "projects(key)" — ` +
            `no commas, no direction suffix.`,
        );
      }
    }
  }

  if (!Number.isInteger(d.pageSize) || d.pageSize < 1 || d.pageSize > 100) {
    throw new Error(
      `${where}: pageSize must be an integer in 1..100, got ${d.pageSize}. ` +
        `The ceiling matches the server's clamp; a larger value here would be overridden.`,
    );
  }
}

/**
 * Declares a resource.
 *
 * Curried, which looks odd until you try the single-call form and find `TRow`
 * inferred as `unknown`: it appears only in callback parameters, so there is
 * nothing for inference to work from. Fixing the row and context types in the
 * first call means the second call gets them contextually, and every
 * `cell: (row, ctx) => …` is fully typed with no annotations.
 *
 * The `const` type parameter is what preserves the column ids as literal types,
 * which is what makes `SortableId` able to compute the sortable union.
 *
 * ```ts
 * export const issues = defineResource<IssueRow, IssuesCtx, CellProps>()({ … });
 * type IssueSort = SortableId<typeof issues>;   // "key" | "title" | "status" | …
 * ```
 */
export function defineResource<
  TRow,
  TCtx = void,
  TCellProps extends object = Record<string, unknown>,
>() {
  return <const D extends ResourceDescriptor<TRow, TCtx, TCellProps>>(descriptor: D): D => {
    assertDescriptor(descriptor as unknown as ResourceDescriptor<never, never, never>);
    return descriptor;
  };
}
