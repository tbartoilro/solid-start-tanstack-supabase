import { describe, expect, it } from "vitest";
import { canDescribe, describeTables, emitDescriptor } from "./emit.js";
import { groupByTable, inferKind, inferSortable, type IntrospectRow } from "./introspect.js";

/**
 * Fixtures taken from this repo's own schema, so the assertions describe real
 * shapes rather than invented ones — including the two awkward tables:
 * `audit_log`, whose primary key is a bigserial rather than a uuid, and
 * `role_permissions`, which has no tenant column and so is not a resource.
 */
const rows: IntrospectRow[] = [
  // issues
  r("issues", "id", "uuid", "b", false, true, null, null),
  r("issues", "org_id", "uuid", "b", false, false, "organizations", null),
  r("issues", "project_id", "uuid", "b", false, false, "projects", null),
  r("issues", "title", "text", "b", false, false, null, null),
  r("issues", "status", "issue_status", "e", false, false, null, [
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "done",
    "cancelled",
  ]),
  r("issues", "assignee_id", "uuid", "b", true, false, "profiles", null),
  r("issues", "updated_at", "timestamp with time zone", "b", false, false, null, null),
  // audit_log — bigserial primary key, jsonb payload
  r("audit_log", "id", "bigint", "b", false, true, null, null),
  r("audit_log", "org_id", "uuid", "b", false, false, "organizations", null),
  r("audit_log", "action", "text", "b", false, false, null, null),
  r("audit_log", "metadata", "jsonb", "b", false, false, null, null),
  r("audit_log", "created_at", "timestamp with time zone", "b", false, false, null, null),
  // role_permissions — shared configuration, not tenant data
  r("role_permissions", "role", "app_role", "e", false, true, null, ["owner", "admin"]),
  r("role_permissions", "permission", "app_permission", "e", false, true, null, ["issues.read"]),
];

function r(
  table: string,
  column: string,
  type: string,
  kind: string,
  nullable: boolean,
  pk: boolean,
  references: string | null,
  enumValues: string[] | null,
): IntrospectRow {
  return {
    table_name: table,
    column_name: column,
    data_type: type,
    type_kind: kind,
    nullable,
    is_primary_key: pk,
    references_table: references,
    enum_values: enumValues,
  };
}

const tables = groupByTable(rows);
const byName = (name: string) => tables.find((t) => t.name === name)!;

describe("groupByTable", () => {
  it("groups columns under their table, in order", () => {
    expect(tables.map((t) => t.name)).toEqual(["issues", "audit_log", "role_permissions"]);
    expect(byName("issues").columns.map((c) => c.name)).toEqual([
      "id",
      "org_id",
      "project_id",
      "title",
      "status",
      "assignee_id",
      "updated_at",
    ]);
  });
});

describe("canDescribe", () => {
  it("treats a tenant column as what makes a table a resource", () => {
    // The distinction that matters: issues belong to an organization,
    // role_permissions is configuration every tenant shares.
    expect(canDescribe(byName("issues"))).toBe(true);
    expect(canDescribe(byName("audit_log"))).toBe(true);
    expect(canDescribe(byName("role_permissions"))).toBe(false);
  });
});

describe("inferKind", () => {
  it("reads the Postgres type", () => {
    const columns = byName("issues").columns;
    expect(inferKind(columns.find((c) => c.name === "status")!)).toBe("enum");
    expect(inferKind(columns.find((c) => c.name === "assignee_id")!)).toBe("relation");
    expect(inferKind(columns.find((c) => c.name === "updated_at")!)).toBe("date");
    expect(inferKind(columns.find((c) => c.name === "title")!)).toBe("text");
    expect(inferKind(byName("audit_log").columns.find((c) => c.name === "metadata")!)).toBe("json");
  });
});

describe("inferSortable", () => {
  it("declines relations and json", () => {
    // A sortable header that reorders nothing is worse than one that does not
    // invite the click. A relation is reached through a join the generator
    // cannot reason about, and json has no meaningful order.
    const columns = byName("issues").columns;
    expect(inferSortable(columns.find((c) => c.name === "assignee_id")!)).toBe(false);
    expect(inferSortable(byName("audit_log").columns.find((c) => c.name === "metadata")!)).toBe(
      false,
    );
    expect(inferSortable(columns.find((c) => c.name === "title")!)).toBe(true);
    expect(inferSortable(columns.find((c) => c.name === "status")!)).toBe(true);
  });
});

describe("emitDescriptor", () => {
  const issues = emitDescriptor(byName("issues"));
  const audit = emitDescriptor(byName("audit_log"));

  it("names the table and derives a title", () => {
    expect(issues).toContain('table: "issues"');
    expect(audit).toContain('title: "Audit log"');
  });

  it("carries the primary key's type through, uuid or bigint", () => {
    // audit_log is the one table keyed on a bigserial, and a bulk request's id
    // validation follows this field — a wrong guess would reject every id.
    expect(issues).toContain('idType: "uuid"');
    expect(audit).toContain('idType: "bigint"');
  });

  it("marks permissions as unresolved rather than guessing", () => {
    // Nothing in a schema says memberships are administered under
    // "members.manage". A confident wrong answer here is a security bug.
    expect(issues).toContain('read: "TODO.read"');
    expect(issues).toMatch(/TODO: permissions cannot be derived from a schema/);
  });

  it("gives exactly one column the primary layout", () => {
    expect(issues.match(/layout: "primary"/g)).toHaveLength(1);
  });

  it("omits the tenant and bookkeeping columns from the visible set", () => {
    expect(issues).not.toContain('id: "orgId"');
    expect(issues).not.toContain('id: "createdBy"');
  });

  it("keeps the timestamp as a hidden sortable column", () => {
    // The default sort is routinely a column no screen displays. Hidden rather
    // than absent, or the default could not be named in a URL.
    expect(issues).toContain('id: "updatedAt"');
    expect(issues).toContain("hidden: true");
    expect(issues).toContain('defaultSort: { column: "updatedAt"');
  });

  it("records enum values in declaration order", () => {
    expect(issues).toContain("backlog, todo, in_progress, in_review, done, cancelled");
  });

  it("explains why a relation column is not sortable", () => {
    expect(issues).toMatch(/Not sortable: reached through a foreign key/);
  });
});

describe("describeTables", () => {
  it("says what it will and will not emit, and why", () => {
    const lines = describeTables(tables);
    expect(lines[0]).toContain("emit  issues");
    expect(lines[2]).toContain("skip  role_permissions");
    expect(lines[2]).toContain("not tenant-scoped");
  });
});

/**
 * The test that was missing.
 *
 * The suite above checked what the output *says* and passed while the emitter
 * produced a file that did not parse: a comment was being joined to the
 * property list with commas, which put a comma inside the comment and swallowed
 * the one the previous property needed. Asserting on substrings cannot see
 * that. This checks the shape instead.
 */
describe("emitted source is syntactically well-formed", () => {
  for (const table of tables.filter((t) => canDescribe(t))) {
    it(`${table.name} balances its delimiters and comments no commas`, () => {
      const source = emitDescriptor(table);

      for (const [open, close] of [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ]) {
        const opens = source.split(open).length - 1;
        const closes = source.split(close).length - 1;
        expect(opens, `unbalanced ${open}${close} in ${table.name}`).toBe(closes);
      }

      // A comma appended after a sentence-ending period is the exact bug: the
      // comma is inside the comment, so it separates nothing. Prose that simply
      // wraps mid-sentence on a comma is fine, so the check is narrow.
      const swallowedComma = source
        .split("\n")
        .filter((line) => /^\s*\/\/.*[.")\]}],\s*$/.test(line));
      expect(swallowedComma, "a comma was absorbed into a comment").toEqual([]);

      // Every property line inside the column literals must end in a comma or
      // an opening brace; anything else means a separator went missing.
      const dangling = source
        .split("\n")
        .filter((line) => /^\s{6}[a-zA-Z]+:/.test(line))
        .filter((line) => !/[,{]\s*$/.test(line));
      expect(dangling, `property without a trailing comma in ${table.name}`).toEqual([]);
    });
  }
});
