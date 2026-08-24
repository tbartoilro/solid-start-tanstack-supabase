import { defineResource, sortableIds, type SortableId } from "@orgadmin/core";
import type { MemberRow } from "~/server/services/members";
import type { TableCellProps } from "./registry";

/** Organization members, as a resource. */
export const membersResource = defineResource<MemberRow, unknown, TableCellProps>()({
  name: "members",
  table: "memberships",
  title: "Members",

  // The mapped row exposes the membership's own id as `membershipId`, because it
  // also carries a `userId` and one bare `id` between them would be ambiguous.
  // This is the case that makes `rowId` and `idColumn` separate fields.
  rowId: (row) => row.membershipId,
  idColumn: "id",
  idType: "uuid",
  rowLabel: (row) => row.fullName ?? row.email,

  permission: { read: "members.read", write: "members.manage", delete: "members.manage" },

  defaultSort: { column: "joinedAt", dir: "asc" },
  pageSize: 25,
  select: "id, user_id, role, created_at, profiles!inner(id, email, full_name, avatar_url)",

  columns: [
    {
      id: "fullName",
      label: "Name",
      layout: "primary",
      // Sortable through the embed, unlike the assignee and actor columns
      // elsewhere, because this one is `profiles!inner` — the membership always
      // has a profile, so the inner join drops nothing and the parent can be
      // ordered by it.
      sortBy: "profiles(full_name)",
      searchAs: "profiles.full_name",
      kind: "text",
    },
    {
      id: "email",
      label: "Email",
      layout: "label",
      sortBy: "profiles(email)",
      searchAs: "profiles.email",
      kind: "text",
      cellProps: { overflowWrap: "anywhere" },
    },
    {
      id: "role",
      label: "Role",
      layout: "label",
      // `app_role` is declared owner → viewer, so ascending is most-privileged
      // first rather than alphabetical.
      sortBy: "role",
      kind: "enum",
    },
    {
      id: "joinedAt",
      label: "Joined",
      sortBy: "created_at",
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

export type MemberSort = SortableId<typeof membersResource>;
export const MEMBER_SORTS = sortableIds(membersResource) as [MemberSort, ...MemberSort[]];
export const MEMBER_DEFAULT_SEARCH = {
  page: 1,
  sort: membersResource.defaultSort.column as MemberSort,
  dir: membersResource.defaultSort.dir,
} as const;
