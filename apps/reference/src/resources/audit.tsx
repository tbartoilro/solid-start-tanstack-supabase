import { defineResource, sortableIds, type SortableId } from "@orgadmin/core";
import { Box } from "styled-system/jsx";
import { Badge } from "~/components/ui/badge";
import { Text } from "~/components/ui/text";
import type { Json } from "~/lib/database.types";
import type { TableCellProps } from "./registry";

/**
 * The audit log, as a resource.
 *
 * Converted first, deliberately: four columns, no permissions beyond reading
 * the page, no row actions and no mutations at all. If the descriptor and the
 * generic table can reproduce this screen exactly, the card contract survives —
 * and if they cannot, the only thing affected is one read-only page.
 */

export interface AuditRow {
  id: number;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Json;
  createdAt: string;
  actor: { fullName: string | null; email: string } | null;
}

export const auditResource = defineResource<AuditRow, void, TableCellProps>()({
  name: "audit",
  table: "audit_log",
  title: "Audit log",

  // Stringified because selection state is keyed by string, and this is the one
  // table in the schema whose primary key is a bigserial rather than a uuid.
  rowId: (row) => String(row.id),
  idColumn: "id",
  idType: "bigint",
  rowLabel: (row) => `${row.action} at ${row.createdAt}`,

  // No write, no delete — and not merely by convention. `audit_log` is granted
  // `select` only and has no INSERT/UPDATE/DELETE policy, so Postgres refuses
  // regardless of what the application asks for. Entries are written by
  // SECURITY DEFINER triggers.
  permission: { read: "audit.read" },
  readOnly: true,

  defaultSort: { column: "createdAt", dir: "desc" },
  pageSize: 50,
  select: "id, action, target_type, target_id, metadata, created_at, profiles(full_name, email)",

  columns: [
    {
      id: "createdAt",
      label: "When",
      layout: "label",
      sortBy: "created_at",
      sortDescFirst: true,
      kind: "date",
      cellProps: { whiteSpace: "nowrap", color: "fg.muted" },
      cell: (row) => new Date(row.createdAt).toLocaleString(),
    },
    {
      id: "actor",
      label: "Actor",
      layout: "label",
      // Not sortable. `actor_id` references profiles with ON DELETE SET NULL,
      // so the embed is a left join; ordering a parent by a left-joined embed
      // is unreliable, and making it inner would hide exactly the rows you most
      // want to see — the ones written with no actor, which read as "system".
      kind: "relation",
      cell: (row) => row.actor?.fullName ?? row.actor?.email ?? "system",
    },
    {
      id: "action",
      // The action names the event, so it heads the card. A timestamp would be
      // the obvious first column on a desktop table but identifies nothing on
      // its own — scanning a phone you look for what happened, then when.
      label: "Action",
      layout: "primary",
      sortBy: "action",
      kind: "text",
      cell: (row) => (
        <Badge size="sm" variant="outline" fontFamily="mono">
          {row.action}
        </Badge>
      ),
    },
    {
      id: "metadata",
      label: "Details",
      // `block` rather than `label`: the value is JSON and routinely long, so
      // the label goes on its own line above it instead of sharing a row.
      layout: "block",
      kind: "json",
      /*
        Metadata is arbitrary trigger-written JSON, so its serialised length is
        unbounded. The cap has to live on an inner box: under auto table layout
        a `td`'s own max-width is ignored, so without this one long entry
        stretches the table past the scroll container's minimum and squeezes
        every other column. Two lines then ellipsis keeps rows a uniform height
        while still showing the start of the payload, which is the part that
        identifies it; the full value is on the title attribute.

        Narrower at `lg` than further up. This is the only table wide enough to
        still overflow once the others fit: When, Actor and Action need roughly
        440px, and at 1024px the sidebar leaves about 704px, so a 24rem Details
        column pushed the total past the container and it scrolled. Widened
        again at `xl`, where there is room for it.
      */
      cell: (row) => (
        <Box maxW={{ base: "24rem", lg: "15rem", xl: "24rem" }}>
          <Text
            as="code"
            fontFamily="mono"
            fontSize="xs"
            color="fg.muted"
            wordBreak="break-all"
            lineClamp={2}
            title={JSON.stringify(row.metadata)}
          >
            {JSON.stringify(row.metadata)}
          </Text>
        </Box>
      ),
    },
  ],
});

/**
 * The sort values this screen accepts, computed from the descriptor.
 *
 * This is the client half of the allowlist: a `?sort=` the server would refuse
 * is a type error here rather than a silent fallback found in production.
 */
export type AuditSort = SortableId<typeof auditResource>;

/**
 * The same set at runtime, for the route's `validateSearch`.
 *
 * Via core's helper rather than filtering `columns` here: the `const` inference
 * that makes `SortableId` work also means columns without a `sortBy` have no
 * such property, so reading it off the union is a type error.
 */
export const AUDIT_SORTS = sortableIds(auditResource) as [AuditSort, ...AuditSort[]];

/**
 * The default search params for this resource's screen.
 *
 * Links need these spelled out even though the schema defaults them: zod's
 * inferred *input* type for a `.catch()` field is the field's own type rather
 * than `T | undefined`, so the router asks for all three. Deriving them from
 * the descriptor keeps one definition of "the default view" instead of a
 * literal at every link.
 */
export const AUDIT_DEFAULT_SEARCH = {
  page: 1,
  sort: auditResource.defaultSort.column as AuditSort,
  dir: auditResource.defaultSort.dir,
} as const;
