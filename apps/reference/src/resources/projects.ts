import { defineResource, sortableIds, type SortableId } from "@orgadmin/core";
import type { ProjectSummary } from "~/server/services/projects";
import type { TableCellProps } from "./registry";

/** Projects, as a resource. */
export const projectsResource = defineResource<ProjectSummary, unknown, TableCellProps>()({
  name: "projects",
  table: "projects",
  title: "Projects",

  rowId: (row) => row.id,
  idColumn: "id",
  idType: "uuid",
  rowLabel: (row) => row.name,

  permission: { read: "projects.read", write: "projects.write", delete: "projects.delete" },

  defaultSort: { column: "name", dir: "asc" },
  pageSize: 25,
  select: "id, name, key, description, archived_at, issues(count)",

  columns: [
    {
      id: "key",
      label: "Key",
      layout: "label",
      // Already efficiently sortable: `unique (org_id, key)` provides the
      // composite index this ordering wants.
      sortBy: "key",
      kind: "text",
    },
    {
      id: "name",
      label: "Name",
      layout: "primary",
      sortBy: "name",
      searchAs: "name",
      kind: "text",
    },
    {
      id: "openIssues",
      label: "Open issues",
      layout: "label",
      // Not sortable, and not fixable here. The value is `issues(count)`, an
      // aggregate over an embedded resource, and PostgREST cannot ORDER BY one.
      // Making it sortable needs a view or a denormalised counter on the row.
      kind: "number",
      cellProps: { textAlign: "right" },
      headerProps: { textAlign: "right" },
    },
    {
      id: "archivedAt",
      label: "Archived",
      sortBy: "archived_at",
      sortDescFirst: true,
      kind: "date",
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

export type ProjectSort = SortableId<typeof projectsResource>;
export const PROJECT_SORTS = sortableIds(projectsResource) as [ProjectSort, ...ProjectSort[]];
export const PROJECT_DEFAULT_SEARCH = {
  page: 1,
  sort: projectsResource.defaultSort.column as ProjectSort,
  dir: projectsResource.defaultSort.dir,
} as const;
