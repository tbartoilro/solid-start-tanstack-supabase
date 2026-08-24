import { describe, expect, it } from "vitest";
import { assertDescriptor, defineResource, type ResourceDescriptor } from "./descriptor.js";
import { resolveSort, sortableIds } from "./sort.js";
import { escapeLike } from "./search.js";
import { pageRange, totalPages } from "./page.js";
import { toCsv } from "./csv.js";

interface Row {
  id: string;
  title: string;
  status: string;
  assignee: { name: string } | null;
}

/** A descriptor shaped like a real one, including the awkward parts. */
const resource = defineResource<Row, void>()({
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
  select: "id, title, status",
  columns: [
    { id: "key", label: "Issue", sortBy: ["projects(key)", "number"] },
    { id: "title", label: "Title", layout: "primary", sortBy: "title", searchAs: "title" },
    { id: "status", label: "Status", sortBy: "status" },
    // No sortBy: reached through a left-joined embed, so ordering by it is not
    // reliable and making the join inner would drop unassigned rows.
    { id: "assignee", label: "Assignee" },
    // Sortable but never rendered — it is the default sort.
    { id: "updatedAt", label: "Updated", sortBy: "updated_at", hidden: true },
    { id: "actions", label: "", layout: "actions" },
  ],
});

/** Builds a descriptor with one field overridden, for the invariant tests. */
function withOverride(patch: Partial<ResourceDescriptor<Row, void>>) {
  return { ...resource, ...patch } as unknown as ResourceDescriptor<never, never, never>;
}

describe("assertDescriptor", () => {
  it("accepts a well-formed descriptor", () => {
    expect(() => assertDescriptor(resource as never)).not.toThrow();
  });

  it("requires exactly one primary column", () => {
    // Two bold lines in a card, and no way to tell which identifies the row.
    expect(() =>
      assertDescriptor(
        withOverride({
          columns: [
            { id: "a", label: "A", layout: "primary", sortBy: "a" },
            { id: "b", label: "B", layout: "primary" },
          ],
          defaultSort: { column: "a", dir: "asc" },
        }),
      ),
    ).toThrow(/exactly one column with layout "primary", found 2/);

    expect(() =>
      assertDescriptor(
        withOverride({
          columns: [{ id: "a", label: "A", sortBy: "a" }],
          defaultSort: { column: "a", dir: "asc" },
        }),
      ),
    ).toThrow(/found 0/);
  });

  it("rejects duplicate column ids", () => {
    expect(() =>
      assertDescriptor(
        withOverride({
          columns: [
            { id: "dup", label: "One", layout: "primary", sortBy: "one" },
            { id: "dup", label: "Two" },
          ],
          defaultSort: { column: "dup", dir: "asc" },
        }),
      ),
    ).toThrow(/duplicate column id "dup"/);
  });

  it("rejects a defaultSort that names an unsortable column", () => {
    // The failure this prevents is silent: the list would order by whatever the
    // fallback happened to be, and the header would never show it.
    expect(() => assertDescriptor(withOverride({ defaultSort: { column: "assignee", dir: "asc" } })))
      .toThrow(/not a sortable column/);
    expect(() => assertDescriptor(withOverride({ defaultSort: { column: "nope", dir: "asc" } })))
      .toThrow(/not a sortable column/);
  });

  it("rejects a sortBy carrying a comma or a direction suffix", () => {
    // An author typo that would otherwise become a smuggled second sort term.
    for (const bad of ["title,id", "title.desc", "Projects(Key)", "profiles.email", ""]) {
      expect(() =>
        assertDescriptor(
          withOverride({
            columns: [{ id: "x", label: "X", layout: "primary", sortBy: bad }],
            defaultSort: { column: "x", dir: "asc" },
          }),
        ),
        `expected "${bad}" to be rejected`,
      ).toThrow(/is not a bare column or to-one embed/);
    }
  });

  it("rejects a pageSize the server would override", () => {
    expect(() => assertDescriptor(withOverride({ pageSize: 250 }))).toThrow(/1\.\.100/);
    expect(() => assertDescriptor(withOverride({ pageSize: 0 }))).toThrow(/1\.\.100/);
  });
});

describe("sortableIds", () => {
  it("lists sortable columns, hidden ones included", () => {
    // `updatedAt` must be present or the default sort could not be named in a URL.
    expect(sortableIds(resource as never)).toEqual(["key", "title", "status", "updatedAt"]);
  });
});

describe("resolveSort", () => {
  it("resolves a column id to its physical expression", () => {
    expect(resolveSort(resource as never, "title", "asc")).toEqual([
      { expr: "title", ascending: true },
    ]);
  });

  it("expands a compound sort, every term taking the requested direction", () => {
    expect(resolveSort(resource as never, "key", "desc")).toEqual([
      { expr: "projects(key)", ascending: false },
      { expr: "number", ascending: false },
    ]);
  });

  /**
   * The security property, stated as a test.
   *
   * PostgREST puts `order=` straight into a query string, and it accepts both
   * comma-separated lists and embedded paths — so a string that survived to
   * `.order()` could add a sort term or reach through a join. Every input below
   * must come back as the descriptor's default, and nothing that came from the
   * caller may appear in the output.
   */
  it("never returns a caller-supplied expression", () => {
    const smuggled = [
      "title,id",
      "title.asc,id",
      "projects(name)",
      "profiles(email)",
      "id.desc",
      "updated_at",   // the physical name, not the column id — still not an id
      "",
      "../etc/passwd",
      "title; drop table issues",
      null,
      undefined,
      42,
      ["title"],
      { id: "title" },
    ];

    for (const attempt of smuggled) {
      const terms = resolveSort(resource as never, attempt, "asc");
      expect(terms, `input ${JSON.stringify(attempt)} was not rejected`).toEqual([
        { expr: "updated_at", ascending: true },
      ]);
    }
  });

  it("falls back to the descriptor's direction for a bogus direction", () => {
    expect(resolveSort(resource as never, "title", "sideways")).toEqual([
      { expr: "title", ascending: false }, // defaultSort.dir is "desc"
    ]);
  });

  it("refuses a column that exists but is not sortable", () => {
    expect(resolveSort(resource as never, "assignee", "asc")).toEqual([
      { expr: "updated_at", ascending: true },
    ]);
  });
});

describe("escapeLike", () => {
  it("neutralises wildcards and the escape character", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
    // A trailing backslash would otherwise escape the pattern's own delimiter.
    expect(escapeLike("trailing\\")).toBe("trailing\\\\");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeLike("dark mode")).toBe("dark mode");
  });
});

describe("pageRange / totalPages", () => {
  it("produces an inclusive range", () => {
    expect(pageRange(1, 25)).toEqual({ from: 0, to: 24 });
    expect(pageRange(2, 25)).toEqual({ from: 25, to: 49 });
    expect(pageRange(3, 50)).toEqual({ from: 100, to: 149 });
  });

  it("never reports zero pages", () => {
    // "Page 1 of 0" under an empty state is worse than "Page 1 of 1".
    expect(totalPages(0, 25)).toBe(1);
    expect(totalPages(1, 25)).toBe(1);
    expect(totalPages(25, 25)).toBe(1);
    expect(totalPages(26, 25)).toBe(2);
    expect(totalPages(703, 25)).toBe(29);
  });
});

describe("toCsv", () => {
  const columns = [
    { header: "action", value: (r: { action: string; meta: unknown }) => r.action },
    { header: "metadata", value: (r: { action: string; meta: unknown }) => r.meta },
  ];

  it("writes a header and CRLF rows", () => {
    const csv = toCsv([{ action: "project.created", meta: { key: "WEB" } }], columns);
    expect(csv).toBe('action,metadata\r\nproject.created,"{""key"":""WEB""}"');
  });

  it("quotes only what needs quoting", () => {
    const csv = toCsv([{ action: "plain", meta: "a,b" }], columns);
    expect(csv).toBe('action,metadata\r\nplain,"a,b"');
  });

  /**
   * An audit export is opened in a spreadsheet by definition, and a field
   * starting with `=` is a formula there. Left alone, an action name someone
   * chose could execute in the reviewer's spreadsheet.
   */
  it("defuses values a spreadsheet would treat as a formula", () => {
    for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      const csv = toCsv([{ action: dangerous, meta: null }], columns);
      expect(csv, `"${dangerous}" was not defused`).toContain(`"\t${dangerous}"`);
    }
  });

  it("renders null and undefined as empty", () => {
    expect(toCsv([{ action: "x", meta: null }], columns)).toBe("action,metadata\r\nx,");
  });
});
