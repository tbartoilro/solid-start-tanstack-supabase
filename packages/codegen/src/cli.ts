#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canDescribe, describeTables, emitDescriptor } from "./emit.js";
import { groupByTable, INTROSPECT_SQL, type IntrospectRow } from "./introspect.js";

/**
 * Reads a database and writes descriptor scaffolds.
 *
 *   orgadmin-introspect --container supabase_db_myproject --out src/resources
 *
 * Deliberately shells out to `psql` inside the database container rather than
 * taking a Postgres driver as a dependency. The generator runs once in a while
 * on a developer's machine, and the alternative is adding a driver — with its
 * native build step — to a package that otherwise has no dependencies at all.
 * The repo already reaches the database this way for its demo-data loader.
 *
 * Nothing here is destructive: it prints what it would write unless given
 * `--out`, and it never touches a file it did not generate.
 */

interface Options {
  container: string;
  schema: string;
  out: string | null;
  tenantColumn: string;
  dryRun: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    container: "",
    schema: "public",
    out: null,
    tenantColumn: "org_id",
    dryRun: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--container") options.container = next();
    else if (arg === "--schema") options.schema = next();
    else if (arg === "--out") {
      options.out = next();
      options.dryRun = false;
    } else if (arg === "--tenant-column") options.tenantColumn = next();
    else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
  }

  if (!options.container) {
    usage();
    throw new Error("--container is required: the name of the Postgres container to read.");
  }
  return options;
}

function usage(): void {
  process.stdout.write(
    [
      "orgadmin-introspect — write resource descriptor scaffolds from a database",
      "",
      "  --container <name>       Postgres container to read (required)",
      "  --schema <name>          schema to introspect (default: public)",
      "  --out <dir>              write files here; omit to print a summary only",
      "  --tenant-column <name>   the column that scopes a row to a tenant (default: org_id)",
      "",
      "Every generated file carries TODOs where the schema could not answer —",
      "permissions above all, which are not derivable and must not be guessed.",
      "",
    ].join("\n"),
  );
}

/** Runs the catalogue query and returns its rows. */
function introspect(options: Options): IntrospectRow[] {
  // `-t -A -F$'\\x1f'` gives unaligned, untitled, unit-separated output, which
  // needs no CSV parsing and cannot collide with a value.
  const sql = INTROSPECT_SQL.replace("$1", `'${options.schema}'`);
  const raw = execFileSync(
    "docker",
    ["exec", "-i", options.container, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-F", "", "-c", sql],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [table, column, type, kind, nullable, pk, references, enums] = line.split("");
      return {
        table_name: table!,
        column_name: column!,
        data_type: type!,
        type_kind: kind!,
        nullable: nullable === "t",
        is_primary_key: pk === "t",
        references_table: references ? references : null,
        // psql renders an array as `{a,b,c}`; empty comes back as `{}` or blank.
        enum_values:
          enums && enums !== "{}" ? enums.replace(/^\{|\}$/g, "").split(",").filter(Boolean) : null,
      } satisfies IntrospectRow;
    });
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const tables = groupByTable(introspect(options));

  process.stdout.write(`\nFound ${tables.length} tables in "${options.schema}":\n`);
  process.stdout.write(describeTables(tables, { tenantColumn: options.tenantColumn }).join("\n"));
  process.stdout.write("\n\n");

  const describable = tables.filter((t) => canDescribe(t, { tenantColumn: options.tenantColumn }));

  if (options.dryRun) {
    process.stdout.write(
      `Would write ${describable.length} descriptors. Pass --out <dir> to write them.\n`,
    );
    return;
  }

  mkdirSync(options.out!, { recursive: true });
  for (const table of describable) {
    const file = join(options.out!, `${table.name}.generated.ts`);
    writeFileSync(file, emitDescriptor(table, { tenantColumn: options.tenantColumn }));
    process.stdout.write(`  wrote ${file}\n`);
  }

  process.stdout.write(
    `\n${describable.length} descriptors written. Each one has TODOs — the permissions\n` +
      `especially, which no schema can answer. Review before wiring anything up.\n`,
  );
}

main();
