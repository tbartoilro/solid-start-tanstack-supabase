import { Badge } from "~/components/ui/badge";
import type { Database } from "~/lib/database.types";

type IssueStatus = Database["public"]["Enums"]["issue_status"];
type IssuePriority = Database["public"]["Enums"]["issue_priority"];

/**
 * Status and priority as colour-coded badges.
 *
 * Colour is never the only signal — the label is always present — so this stays
 * readable for anyone who cannot distinguish the palettes.
 */
const STATUS_PALETTE: Record<IssueStatus, string> = {
  backlog: "gray",
  todo: "gray",
  in_progress: "blue",
  in_review: "amber",
  done: "green",
  cancelled: "gray",
};

const STATUS_LABEL: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};

export function StatusBadge(props: { status: IssueStatus }) {
  return (
    <Badge size="sm" variant="subtle" colorPalette={STATUS_PALETTE[props.status]}>
      {STATUS_LABEL[props.status]}
    </Badge>
  );
}

const PRIORITY_PALETTE: Record<IssuePriority, string> = {
  none: "gray",
  low: "gray",
  medium: "blue",
  high: "amber",
  urgent: "red",
};

export function PriorityBadge(props: { priority: IssuePriority }) {
  return (
    <Badge size="sm" variant="outline" colorPalette={PRIORITY_PALETTE[props.priority]}>
      {props.priority}
    </Badge>
  );
}

/** Monospace project key / issue reference, e.g. WEB-12. */
export function IssueKey(props: { children: string }) {
  return (
    <Badge size="sm" variant="outline" fontFamily="mono" whiteSpace="nowrap">
      {props.children}
    </Badge>
  );
}
