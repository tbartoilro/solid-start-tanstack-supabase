import {
  camel,
  humanise,
  inferKind,
  inferPrimaryColumn,
  inferSearchable,
  inferSortable,
  isTenantTable,
  tenantColumn,
  type ColumnFacts,
  type TableFacts,
} from "./introspect.js";

/**
 * Turns table facts into a descriptor source file.
 *
 * The output is a starting point that compiles, not a finished descriptor. Every
 * inference the generator had to guess at carries a `TODO`, and the guesses are
 * concentrated in two places: the permission names, which are not derivable from
 * a schema at all, and which column identifies a row.
 *
 * Being explicit about that is the point. A generator that emitted confident
 * wrong answers would be worse than one that emitted none, because the reader
 * would have no way to tell which parts to check.
 */

export interface EmitOptions {
  /** The column that scopes a row to a tenant. */
  tenantColumn?: string;
  /** Columns no screen should show — audit trails, tenant keys, soft deletes. */
  hiddenColumns?: readonly string[];
  pageSize?: number;
}

const DEFAULT_HIDDEN = ["org_id", "created_by", "updated_at", "created_at"];

/** Whether the generator can describe this table at all. */
export function canDescribe(table: TableFacts, options: EmitOptions = {}): boolean {
  return isTenantTable(table, options.tenantColumn ?? "org_id");
}

function idTypeOf(pk: ColumnFacts | undefined): "uuid" | "bigint" {
  return pk?.type === "uuid" ? "uuid" : "bigint";
}

function columnSource(
  column: ColumnFacts,
  opts: { primary: boolean; hidden: boolean },
): string {
  const id = camel(column.name);
  const parts = [`      id: ${JSON.stringify(id)}`, `      label: ${JSON.stringify(humanise(column.name))}`];

  if (opts.primary) parts.push(`      layout: "primary"`);
  if (opts.hidden) parts.push(`      hidden: true`);
  if (inferSortable(column)) {
    parts.push(`      sortBy: ${JSON.stringify(column.name)}`);
    // Dates and numbers read newest/highest first; that is what someone is
    // looking for when they click the header.
    const kind = inferKind(column);
    if (kind === "date" || kind === "number") parts.push(`      sortDescFirst: true`);
  } else if (column.references) {
    parts.push(
      `      // Not sortable: reached through a foreign key, so the embed is a`,
      `      // left join when the column is nullable and ordering a parent by`,
      `      // one is unreliable. Making the join inner would hide rows with`,
      `      // nothing on the other side. TODO: confirm this is what you want.`,
    );
  }
  if (inferSearchable(column)) parts.push(`      searchAs: ${JSON.stringify(column.name)}`);
  parts.push(`      kind: ${JSON.stringify(inferKind(column))}`);

  if (column.enumValues?.length) {
    parts.push(
      `      // Values, in declaration order — which is also how Postgres sorts`,
      `      // them, so ascending is semantic rather than alphabetical:`,
      `      // ${column.enumValues.join(", ")}`,
    );
  }

  return `    {\n${parts.join(",\n").replace(/,\n(\s+\/\/)/g, "\n$1")},\n    }`;
}

export function emitDescriptor(table: TableFacts, options: EmitOptions = {}): string {
  const tenant = options.tenantColumn ?? "org_id";
  const hidden = new Set([...(options.hiddenColumns ?? DEFAULT_HIDDEN), tenant]);

  const pk = table.columns.find((c) => c.isPrimaryKey);
  const primary = inferPrimaryColumn(table.columns.filter((c) => !hidden.has(c.name)));
  const shown = table.columns.filter((c) => !c.isPrimaryKey && !hidden.has(c.name));

  // Hidden columns still make useful default sorts — a table is usually ordered
  // newest-first by a timestamp no column displays.
  const sortFallback = table.columns.find((c) => c.name === "created_at" || c.name === "updated_at");
  const sortColumn = sortFallback ?? primary ?? shown[0];

  const columns = [
    ...shown.map((c) => columnSource(c, { primary: c.name === primary?.name, hidden: false })),
    ...(sortFallback ? [columnSource(sortFallback, { primary: false, hidden: true })] : []),
  ];

  const name = camel(table.name);
  const rowType = `${name.charAt(0).toUpperCase()}${name.slice(1)}Row`;

  return `import { defineResource, sortableIds, type SortableId } from "@orgadmin/core";
import type { TableCellProps } from "./registry";

/**
 * Generated from the ${table.name} table. Edit freely — regenerating overwrites
 * this file, so move anything you want to keep, or stop regenerating it.
 *
 * Every TODO below marks something the schema could not answer.
 */

// TODO: replace with the row type your service actually returns. The generator
// cannot know how you map columns — most services rename and nest them.
export interface ${rowType} {
${table.columns.map((c) => `  ${camel(c.name)}: unknown;`).join("\n")}
}

export const ${name}Resource = defineResource<${rowType}, unknown, TableCellProps>()({
  name: ${JSON.stringify(name)},
  table: ${JSON.stringify(table.name)},
  title: ${JSON.stringify(humanise(table.name))},

  rowId: (row) => String(row.${camel(pk?.name ?? "id")}),
  idColumn: ${JSON.stringify(pk?.name ?? "id")},
  idType: ${JSON.stringify(idTypeOf(pk))},
  // TODO: what a person would call one of these — an email, a key, a title.
  // Used for confirmation copy and per-row accessible names, so a table of
  // controls stays distinguishable.
  rowLabel: (row) => String(row.${camel(primary?.name ?? pk?.name ?? "id")}),

  // TODO: permissions cannot be derived from a schema. Name the ones this
  // resource is actually gated on; a wrong guess here is a security bug, not a
  // typo, so the generator does not pretend to know.
  permission: { read: "TODO.read" as never, write: "TODO.write" as never },

  defaultSort: { column: ${JSON.stringify(camel(sortColumn?.name ?? "id"))}, dir: "desc" },
  pageSize: ${options.pageSize ?? 25},

  // TODO: add embeds for any relation column you want to display by name
  // rather than by id.
  select: ${JSON.stringify(table.columns.map((c) => c.name).join(", "))},

  columns: [
${columns.join(",\n")},
  ],
});

export type ${rowType}Sort = SortableId<typeof ${name}Resource>;
export const ${name.toUpperCase()}_SORTS = sortableIds(${name}Resource) as [
  ${rowType}Sort,
  ...${rowType}Sort[],
];
`;
}

/** A one-line summary per table, for the CLI to print. */
export function describeTables(tables: readonly TableFacts[], options: EmitOptions = {}): string[] {
  const tenant = options.tenantColumn ?? "org_id";
  return tables.map((t) => {
    if (!isTenantTable(t, tenant)) {
      return `  skip  ${t.name} — no ${tenant} column, so it is not tenant-scoped`;
    }
    const enums = t.columns.filter((c) => c.kind === "e").length;
    const relations = t.columns.filter((c) => c.references).length;
    return `  emit  ${t.name} — ${t.columns.length} columns, ${enums} enum, ${relations} relation`;
  });
}

export { tenantColumn };
