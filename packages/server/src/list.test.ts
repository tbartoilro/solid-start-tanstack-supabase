import { defineResource } from "@orgadmin/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { applyList, listSchemaFor, type ListQuery } from "./list.js";
import { bulkSchemaFor, idSchemaFor, runBulk } from "./bulk.js";

interface Row {
  id: string;
  title: string;
}

const orgScoped = z.object({ orgSlug: z.string().min(1) });

const issues = defineResource<Row, void>()({
  name: "issues",
  table: "issues",
  title: "Issues",
  rowId: (row) => row.id,
  idColumn: "id",
  idType: "uuid",
  rowLabel: (row) => row.title,
  permission: { read: "issues.read", write: "issues.write" },
  defaultSort: { column: "updatedAt", dir: "desc" },
  pageSize: 25,
  select: "id, title",
  columns: [
    { id: "key", label: "Issue", sortBy: ["projects(key)", "number"] },
    { id: "title", label: "Title", layout: "primary", sortBy: "title", searchAs: "title" },
    { id: "assignee", label: "Assignee" },
    { id: "updatedAt", label: "Updated", sortBy: "updated_at", hidden: true },
  ],
});

const auditLog = defineResource<{ id: number; action: string }, void>()({
  name: "audit",
  table: "audit_log",
  title: "Audit log",
  rowId: (row) => String(row.id),
  idColumn: "id",
  // The one table that keys on a bigserial rather than a uuid.
  idType: "bigint",
  rowLabel: (row) => row.action,
  permission: { read: "audit.read" },
  readOnly: true,
  defaultSort: { column: "createdAt", dir: "desc" },
  pageSize: 50,
  select: "id, action, created_at",
  columns: [
    { id: "createdAt", label: "When", sortBy: "created_at" },
    { id: "action", label: "Action", layout: "primary", sortBy: "action" },
  ],
});

/**
 * A stand-in for the PostgREST builder that records what it was asked to do.
 *
 * This is why `applyList` takes a structural type: the sort allowlist can be
 * asserted on exactly the arguments that would have reached the real query,
 * with no database and no network.
 */
interface Recorder extends ListQuery<Recorder> {
  readonly orders: Array<[string, { ascending: boolean }]>;
  readonly ilikes: Array<[string, string]>;
  readonly ors: string[];
  readonly ranges: Array<[number, number]>;
}

function recorder(): Recorder {
  const self: Recorder = {
    orders: [],
    ilikes: [],
    ors: [],
    ranges: [],
    order(column, options) {
      self.orders.push([column, options]);
      return self;
    },
    ilike(column, pattern) {
      self.ilikes.push([column, pattern]);
      return self;
    },
    or(filters) {
      self.ors.push(filters);
      return self;
    },
    range(from, to) {
      self.ranges.push([from, to]);
      return self;
    },
  };
  return self;
}

const parse = (raw: unknown) => listSchemaFor(issues as never, orgScoped).parse(raw);

describe("listSchemaFor", () => {
  it("fills in the descriptor's defaults", () => {
    expect(parse({ orgSlug: "acme" })).toMatchObject({
      page: 1,
      pageSize: 25,
      sort: "updatedAt",
      dir: "desc",
    });
  });

  it("degrades bad input instead of rejecting it", () => {
    // A mangled URL should render a sensible page, not an error.
    expect(parse({ orgSlug: "acme", page: "banana" }).page).toBe(1);
    expect(parse({ orgSlug: "acme", page: 0 }).page).toBe(1);
    expect(parse({ orgSlug: "acme", pageSize: 100000 }).pageSize).toBe(25);
    expect(parse({ orgSlug: "acme", dir: "sideways" }).dir).toBe("desc");
  });

  it("clamps pageSize to the public ceiling", () => {
    expect(parse({ orgSlug: "acme", pageSize: 100 }).pageSize).toBe(100);
    expect(parse({ orgSlug: "acme", pageSize: 101 }).pageSize).toBe(25);
  });

  it("accepts a sortable id, including a hidden one", () => {
    expect(parse({ orgSlug: "acme", sort: "title" }).sort).toBe("title");
    expect(parse({ orgSlug: "acme", sort: "updatedAt" }).sort).toBe("updatedAt");
  });

  it("replaces an unsortable or unknown id with the default", () => {
    expect(parse({ orgSlug: "acme", sort: "assignee" }).sort).toBe("updatedAt");
    expect(parse({ orgSlug: "acme", sort: "title,id" }).sort).toBe("updatedAt");
  });

  it("still requires the base schema to hold", () => {
    expect(() => parse({})).toThrow();
  });
});

describe("applyList", () => {
  const base = { page: 1, pageSize: 25, sort: "updatedAt", dir: "desc" } as const;

  it("orders, then ranges", () => {
    const q = recorder();
    applyList(q, issues as never, { ...base });
    expect(q.orders).toEqual([
      ["updated_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(q.ranges).toEqual([[0, 24]]);
  });

  it("expands a compound sort into one order call per term", () => {
    const q = recorder();
    applyList(q, issues as never, { ...base, sort: "key", dir: "asc" });
    expect(q.orders).toEqual([
      ["projects(key)", { ascending: true }],
      ["number", { ascending: true }],
      ["id", { ascending: true }],
    ]);
  });

  it("pages by offset", () => {
    const q = recorder();
    applyList(q, issues as never, { ...base, page: 3, pageSize: 50 });
    expect(q.ranges).toEqual([[100, 149]]);
  });

  it("escapes LIKE wildcards in the search term", () => {
    const q = recorder();
    applyList(q, issues as never, { ...base, search: "100%_done" });
    expect(q.ilikes).toEqual([["title", "%100\\%\\_done%"]]);
  });

  /**
   * The security assertion, at the layer that actually calls `.order()`.
   *
   * PostgREST puts the first argument of `order()` straight into the `order`
   * query parameter, and that parameter accepts a comma-separated list and
   * embedded-resource paths. So each of these strings, if it survived to the
   * query, would either add a sort term or order by a table the caller was not
   * meant to touch. Every one must produce the descriptor's default and
   * nothing else.
   */
  it("never passes a caller-supplied string to order()", () => {
    const hostile = [
      "title,id",
      "title.asc,id.desc",
      "projects(name)",
      "profiles(email)",
      "updated_at",           // the physical column name is not a column id
      "id",
      "",
      "title);select 1--",
      "assignee",             // exists, but has no sortBy
    ];

    for (const sort of hostile) {
      const q = recorder();
      applyList(q, issues as never, { ...base, sort, dir: "asc" });
      expect(q.orders, `"${sort}" reached order()`).toEqual([
        ["updated_at", { ascending: true }],
        ["id", { ascending: true }],
      ]);
    }
  });

  it("does not search when the resource has no searchable column", () => {
    const q = recorder();
    applyList(q, auditLog as never, {
      page: 1,
      pageSize: 50,
      sort: "createdAt",
      dir: "desc",
      search: "anything",
    });
    expect(q.ilikes).toEqual([]);
    expect(q.ors).toEqual([]);
  });
});

describe("idSchemaFor / bulkSchemaFor", () => {
  it("validates uuid ids for a uuid resource", () => {
    const schema = idSchemaFor(issues as never);
    expect(schema.parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBeTruthy();
    expect(() => schema.parse("12")).toThrow();
  });

  it("validates numeric ids for the bigserial resource", () => {
    // A shared uuid check would reject every id the audit log sends.
    const schema = idSchemaFor(auditLog as never);
    expect(schema.parse(12)).toBe("12");
    expect(schema.parse("12")).toBe("12");
    expect(() => schema.parse("not-a-number")).toThrow();
  });

  it("requires at least one id and caps the batch", () => {
    const schema = bulkSchemaFor(auditLog as never, orgScoped);
    expect(() => schema.parse({ orgSlug: "acme", ids: [] })).toThrow();
    expect(schema.parse({ orgSlug: "acme", ids: ["1", "2"] }).ids).toEqual(["1", "2"]);
    const tooMany = Array.from({ length: 501 }, (_, i) => String(i + 1));
    expect(() => schema.parse({ orgSlug: "acme", ids: tooMany })).toThrow();
  });
});

describe("runBulk", () => {
  it("reports per-row outcomes rather than failing the batch", async () => {
    // The behaviour that matters: removing five members can refuse on one for
    // being your own account and on another for being the last owner, while
    // the rest go through. One thrown error would hide the successes.
    const outcomes = await runBulk(["a", "b", "c"], async (id) => {
      if (id === "b") throw new Error("You cannot change your own role.");
    });

    expect(outcomes).toEqual([
      { id: "a", ok: true },
      { id: "b", ok: false, error: "You cannot change your own role." },
      { id: "c", ok: true },
    ]);
  });

  it("runs in order", async () => {
    // Sequential because the rules are relative to current state: whether
    // someone is "the last owner" depends on who has already been removed.
    const seen: string[] = [];
    await runBulk(["1", "2", "3"], async (id) => {
      seen.push(id);
    });
    expect(seen).toEqual(["1", "2", "3"]);
  });

  it("does not leak a non-Error throw to the client", async () => {
    const outcomes = await runBulk(["a"], async () => {
      throw { secret: "internal detail" };
    });
    expect(outcomes[0]!.error).toBe("That row could not be updated.");
  });
});
