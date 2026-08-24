import { defineResource, sortableIds, type SortableId } from "@orgadmin/core";
import type { IssueRow } from "~/server/services/issues";
import type { TableCellProps } from "./registry";

/**
 * Issues, as a resource.
 *
 * Serves both issue tables: the cross-project list and a project's own. They
 * render identical columns, so describing them twice would guarantee they drift
 * apart. The project screen supplies `projectId` as a fixed filter and its own
 * context; nothing else differs.
 *
 * Worth recording, because the plan assumed otherwise: the project detail screen
 * does *not* need a separate query to build an issue key. The service select
 * already embeds `projects(id, key, name)`, so `row.project.key` is populated on
 * both screens.
 */

export const issuesResource = defineResource<IssueRow, unknown, TableCellProps>()({
  name: "issues",
  table: "issues",
  title: "Issues",

  rowId: (row) => row.id,
  idColumn: "id",
  idType: "uuid",
  // The key a person would use to refer to this issue out loud. Falls back to
  // the bare number when the project embed is absent, which the type allows.
  rowLabel: (row) => (row.project ? `${row.project.key}-${row.number}` : `#${row.number}`),

  permission: { read: "issues.read", write: "issues.write", delete: "issues.write" },

  defaultSort: { column: "updatedAt", dir: "desc" },
  pageSize: 25,

  // `projects!inner` rather than a plain embed, which is what makes ordering by
  // `projects(key)` order the *parent* rows. Safe: `issues.project_id` is
  // `not null references projects`, so an inner join cannot drop a row. The
  // assignee embed stays a left join, because `assignee_id` is nullable and an
  // inner join there would silently hide every unassigned issue.
  select:
    "id, number, title, status, priority, updated_at, " +
    "projects!inner(id, key, name), " +
    "profiles!issues_assignee_id_fkey(id, full_name, email)",

  columns: [
    {
      id: "key",
      label: "Issue",
      layout: "label",
      // Compound: a key reads as its project then its number, so sorting by it
      // has to do both or WEB-2 lands between API-1 and API-3.
      sortBy: ["projects(key)", "number"],
      kind: "text",
    },
    {
      id: "title",
      label: "Title",
      layout: "primary",
      sortBy: "title",
      searchAs: "title",
      kind: "text",
      cellProps: { overflowWrap: "anywhere" },
    },
    {
      id: "status",
      label: "Status",
      layout: "label",
      // The enum is declared backlog → cancelled, and Postgres orders enums by
      // declaration, so this sorts by workflow position rather than alphabet.
      sortBy: "status",
      kind: "enum",
    },
    {
      id: "priority",
      label: "Priority",
      layout: "label",
      sortBy: "priority",
      // Declared none → urgent, so descending-first puts urgent at the top,
      // which is the reason anyone clicks this header.
      sortDescFirst: true,
      kind: "enum",
    },
    {
      id: "assignee",
      label: "Assignee",
      layout: "label",
      // Deliberately not sortable. The embed is a left join on a nullable
      // column; ordering a parent by one is unreliable, and switching to
      // `!inner` to make it work would drop every unassigned issue from the
      // list — a far worse bug than a header that does not sort.
      kind: "relation",
    },
    {
      id: "updatedAt",
      label: "Updated",
      sortBy: "updated_at",
      sortDescFirst: true,
      kind: "date",
      // The default sort, and there is no Updated column on screen. Hidden
      // rather than absent so the default can still be named in a URL.
      hidden: true,
    },
    {
      id: "actions",
      label: "",
      layout: "actions",
      cellProps: { textAlign: "right" },
    },
  ],
});

export type IssueSort = SortableId<typeof issuesResource>;

export const ISSUE_SORTS = sortableIds(issuesResource) as [IssueSort, ...IssueSort[]];

export const ISSUE_DEFAULT_SEARCH = {
  page: 1,
  sort: issuesResource.defaultSort.column as IssueSort,
  dir: issuesResource.defaultSort.dir,
} as const;
