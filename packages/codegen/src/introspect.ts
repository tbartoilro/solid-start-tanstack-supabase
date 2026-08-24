/**
 * Reads a Postgres schema and works out what a resource descriptor for each
 * tenant table should look like.
 *
 * This is the part that makes the framework self-configuring: point it at a
 * database and it produces descriptors you edit, rather than descriptors you
 * write. The queries are plain catalogue reads — no extensions, no privileges
 * beyond reading `pg_catalog`.
 *
 * What it can infer, and what it cannot, is the whole design. Postgres knows the
 * column types, which are enums and what their values are, which columns are
 * nullable and where the foreign keys point. It does not know that `memberships`
 * is administered under a permission called `members.manage`, or that an
 * aggregate over an embed cannot be sorted. So the generator emits its best
 * guess and marks every guess with a TODO — a scaffold to edit, never a
 * finished file.
 */

export interface ColumnFacts {
  name: string;
  /** `format_type` output: `text`, `uuid`, `timestamp with time zone`, … */
  type: string;
  /** `pg_type.typtype`: 'b' base, 'e' enum, 'c' composite, 'd' domain. */
  kind: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  /** Target table when this column is a foreign key. */
  references: string | null;
  /** Values in declaration order, when the column is an enum. */
  enumValues: string[] | null;
}

export interface TableFacts {
  name: string;
  columns: ColumnFacts[];
}

/**
 * Every base table in a schema, with the column facts a descriptor needs.
 *
 * One query rather than one per table: the lateral subqueries keep it a single
 * round trip, which matters when this runs against a remote database.
 */
export const INTROSPECT_SQL = `
select
  c.relname as table_name,
  a.attname as column_name,
  format_type(a.atttypid, a.atttypmod) as data_type,
  t.typtype as type_kind,
  not a.attnotnull as nullable,
  coalesce(pk.is_pk, false) as is_primary_key,
  fk.target as references_table,
  en.values as enum_values
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
join pg_type t on t.oid = a.atttypid
left join lateral (
  select true as is_pk
  from pg_constraint pc
  where pc.conrelid = c.oid and pc.contype = 'p' and a.attnum = any(pc.conkey)
) pk on true
left join lateral (
  select fc.confrelid::regclass::text as target
  from pg_constraint fc
  where fc.conrelid = c.oid and fc.contype = 'f' and fc.conkey[1] = a.attnum
  limit 1
) fk on true
left join lateral (
  select array_agg(e.enumlabel order by e.enumsortorder) as values
  from pg_enum e where e.enumtypid = t.oid
) en on true
where n.nspname = $1 and c.relkind = 'r'
order by c.relname, a.attnum;
`.trim();

/** One row of the query above, as the driver returns it. */
export interface IntrospectRow {
  table_name: string;
  column_name: string;
  data_type: string;
  type_kind: string;
  nullable: boolean;
  is_primary_key: boolean;
  references_table: string | null;
  enum_values: string[] | null;
}

export function groupByTable(rows: readonly IntrospectRow[]): TableFacts[] {
  const tables = new Map<string, TableFacts>();

  for (const row of rows) {
    let table = tables.get(row.table_name);
    if (!table) {
      table = { name: row.table_name, columns: [] };
      tables.set(row.table_name, table);
    }
    table.columns.push({
      name: row.column_name,
      type: row.data_type,
      kind: row.type_kind,
      nullable: row.nullable,
      isPrimaryKey: row.is_primary_key,
      references: row.references_table,
      enumValues: row.enum_values,
    });
  }

  return [...tables.values()];
}

/**
 * The column that scopes a table to a tenant.
 *
 * A table having one is what makes it a resource at all — it is the difference
 * between `issues`, which belongs to an organization, and `role_permissions`,
 * which is configuration shared by every tenant. Conventional rather than
 * declared, so the name is a parameter.
 */
export function tenantColumn(table: TableFacts, column = "org_id"): ColumnFacts | undefined {
  return table.columns.find((c) => c.name === column);
}

export function isTenantTable(table: TableFacts, column = "org_id"): boolean {
  return tenantColumn(table, column) !== undefined;
}

/** What `kind` a descriptor column should carry, from the Postgres type. */
export function inferKind(column: ColumnFacts): string {
  if (column.kind === "e") return "enum";
  if (column.references) return "relation";
  if (column.type.startsWith("timestamp") || column.type === "date") return "date";
  if (/^(integer|bigint|smallint|numeric|real|double precision)$/.test(column.type)) return "number";
  if (column.type === "jsonb" || column.type === "json") return "json";
  return "text";
}

/**
 * Whether ordering by this column is worth offering.
 *
 * Conservative on purpose. A sortable header that reorders nothing is worse
 * than one that does not invite the click, and three things in this schema
 * cannot be ordered by from the parent row at all: a column reached through a
 * nullable foreign key (the embed is a left join), an aggregate over an embed,
 * and anything the caller cannot see. The generator only knows about the first,
 * so it declines relations and leaves a note.
 */
export function inferSortable(column: ColumnFacts): boolean {
  if (column.references) return false;
  if (column.type === "jsonb" || column.type === "json") return false;
  return true;
}

/** Columns a text search should cover: the short, human-readable ones. */
export function inferSearchable(column: ColumnFacts): boolean {
  return column.type === "text" && !column.references && !column.isPrimaryKey;
}

/**
 * The column that best identifies a row to a person.
 *
 * Used for the `primary` layout, which is the cell hoisted to the top of the
 * card below `lg`. Prefers the conventional names before falling back to the
 * first plain text column, because "the first text column" is right often
 * enough to be useful and wrong often enough to be worth flagging.
 */
export function inferPrimaryColumn(columns: readonly ColumnFacts[]): ColumnFacts | undefined {
  const preferred = ["name", "title", "label", "email", "action", "key"];
  for (const candidate of preferred) {
    const found = columns.find((c) => c.name === candidate);
    if (found) return found;
  }
  return columns.find((c) => c.type === "text" && !c.isPrimaryKey && !c.references);
}

/** `full_name` → `fullName`, matching how the services map rows. */
export function camel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

/** `audit_log` → `Audit log`. */
export function humanise(name: string): string {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
