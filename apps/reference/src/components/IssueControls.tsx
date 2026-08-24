import { Field as ArkField } from "@ark-ui/solid/field";
import { createListCollection } from "@ark-ui/solid/select";
import { ChevronsUpDown } from "lucide-solid";
import { createMemo, createSignal, For, Show, type ComponentProps } from "solid-js";
import { Portal } from "solid-js/web";
import { HStack, Stack, styled } from "styled-system/jsx";
import { textarea } from "styled-system/recipes";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { StatusBadge } from "~/components/StatusBadge";
import { Button } from "~/components/ui/button";
import * as Dialog from "~/components/ui/dialog";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import * as Select from "~/components/ui/select";
import { Text } from "~/components/ui/text";
import { can, type Session, type SessionOrg } from "~/lib/auth";
import type { Database } from "~/lib/database.types";
import {
  assignIssue,
  createIssue,
  deleteIssue,
  setIssueStatus,
  updateIssue,
} from "~/server/rpc/issues";

/**
 * Everything that mutates an issue, as pieces two different screens can drop in.
 *
 * The cross-project issues list and a project's own issue table show the same
 * rows and must offer the same actions. Written once here rather than twice
 * there, because the interesting part is not the markup — it is which control
 * appears for whom, and that rule has to be identical in both places or one of
 * them is wrong.
 *
 * Nothing in this file reads route context. Two routes render these, with
 * different params and different loaders, so the caller passes the session, the
 * org and the slug explicitly.
 *
 * Every gate here only decides what to *render*. The same rules are enforced in
 * `~/server/rpc/issues` and in the database; hiding a control just stops the
 * interface offering a button that would come back 403.
 */

export type IssueStatus = Database["public"]["Enums"]["issue_status"];
export type IssuePriority = Database["public"]["Enums"]["issue_priority"];

export const ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
] as const satisfies readonly IssueStatus[];

export const STATUS_LABEL: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};

export const ISSUE_PRIORITIES = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const satisfies readonly IssuePriority[];

export const PRIORITY_LABEL: Record<IssuePriority, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const statusCollection = createListCollection({
  items: ISSUE_STATUSES.map((s) => ({ label: STATUS_LABEL[s], value: s })),
});

const priorityCollection = createListCollection({
  items: ISSUE_PRIORITIES.map((p) => ({ label: PRIORITY_LABEL[p], value: p })),
});

/**
 * The part of an issue these controls need.
 *
 * Structural rather than an import of the server's `IssueRow`, so a caller can
 * satisfy it from anywhere — and so `description` can be optional, which the
 * list payload does not carry. Rows from `issuesQuery` already fit.
 */
export interface IssueControlsIssue {
  id: string;
  number: number;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  project: { id: string; key: string; name: string } | null;
  assignee: { id: string; fullName: string | null; email: string } | null;
  description?: string | null;
}

/** An assignee option. Rows from `allMembersQuery` fit as they are. */
export interface IssueMemberOption {
  userId: string;
  fullName: string | null;
  email: string;
}

/** A project option for the create form. Rows from `projectsQuery` fit. */
export interface IssueProjectOption {
  id: string;
  name: string;
  key: string;
}

/** Exactly the render-prop shape Ark's `asChild` expects, derived from Ark. */
export type IssueTriggerRender = NonNullable<ComponentProps<typeof Dialog.Trigger>["asChild"]>;

export interface IssueActionProps {
  session: Session | null | undefined;
  org: SessionOrg;
  orgSlug: string;
  /** Ran after a successful mutation. Invalidate the org's "issues" key here. */
  onDone: () => void | Promise<void>;
  /** Where a refusal goes. Without it a failed mutation is silent. */
  onError?: (message: string) => void;
}

/** `WEB-12`. Falls back to the bare number if the row arrived without a project. */
export function issueKey(issue: Pick<IssueControlsIssue, "number" | "project">): string {
  return issue.project ? `${issue.project.key}-${issue.number}` : `#${issue.number}`;
}

/**
 * Status is the one field an assignee may change without `issues.write`: being
 * handed a task carries the right to report on it, so a viewer can close the
 * issue they were assigned. Mirrors `public.set_issue_status`, which is what
 * actually enforces it.
 */
export function canSetStatus(
  session: Session | null | undefined,
  org: SessionOrg,
  issue: Pick<IssueControlsIssue, "assignee">,
): boolean {
  if (can(session, org.id, "issues.write")) return true;
  return !!session && !!issue.assignee && issue.assignee.id === session.user.id;
}

/**
 * Runs one mutation and reports the outcome through the caller's callbacks.
 *
 * Deliberately does not throw: these controls sit inside a table row, and the
 * page that owns the row is the only place with somewhere sensible to put an
 * error message.
 */
async function runMutation(
  props: Pick<IssueActionProps, "onDone" | "onError">,
  fallback: string,
  action: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await action();
    await props.onDone();
    return true;
  } catch (err) {
    props.onError?.(err instanceof Error ? err.message : fallback);
    return false;
  }
}

/**
 * Inline status picker.
 *
 * Calls `setIssueStatus`, never `updateIssue`: the latter demands
 * `issues.write` and would refuse the very assignee this control exists for.
 */
export function IssueStatusSelect(props: IssueActionProps & { issue: IssueControlsIssue }) {
  const [pending, setPending] = createSignal(false);

  return (
    <Show
      when={canSetStatus(props.session, props.org, props.issue)}
      fallback={<StatusBadge status={props.issue.status} />}
    >
      <Select.Root
        size="sm"
        width="9rem"
        collection={statusCollection}
        disabled={pending()}
        value={[props.issue.status]}
        onValueChange={(d) => {
          const next = d.value[0] as IssueStatus | undefined;
          if (!next || next === props.issue.status) return;
          setPending(true);
          void runMutation(props, "Could not change the status.", () =>
            setIssueStatus({ orgSlug: props.orgSlug, issueId: props.issue.id, status: next }),
          ).finally(() => setPending(false));
        }}
        positioning={{ sameWidth: true }}
      >
        {/*
          Named per row rather than "Status": a table of these is a page full of
          identically-named comboboxes otherwise, which is useless to a screen
          reader and ambiguous to a role-and-name locator. Hidden visually
          because the column header and the card label already say it.
        */}
        <Select.Label srOnly>Status for {issueKey(props.issue)}</Select.Label>
        <Select.Control>
          <Select.Trigger>
            <Select.ValueText />
            <Select.IndicatorGroup>
              <Select.Indicator>
                <ChevronsUpDown size={16} />
              </Select.Indicator>
            </Select.IndicatorGroup>
          </Select.Trigger>
        </Select.Control>
        {/*
          Portalled to <body>: rendered inline the list inherits the cell's
          alignment and is clipped by the table's own scroll container.
        */}
        <Portal>
          <Select.Positioner>
            <Select.Content>
              <For each={statusCollection.items}>
                {(item) => (
                  <Select.Item item={item}>
                    <Select.ItemText>{item.label}</Select.ItemText>
                    <Select.ItemIndicator />
                  </Select.Item>
                )}
              </For>
            </Select.Content>
          </Select.Positioner>
        </Portal>
        <Select.HiddenSelect />
      </Select.Root>
    </Show>
  );
}

/**
 * Inline assignee picker.
 *
 * `issues.assign` is separate from `issues.write` on purpose, so this is gated
 * on its own permission and calls its own endpoint.
 */
export function IssueAssigneeSelect(
  props: IssueActionProps & { issue: IssueControlsIssue; members: IssueMemberOption[] },
) {
  const [pending, setPending] = createSignal(false);

  const collection = createMemo(() =>
    createListCollection({
      items: [
        { label: "Unassigned", value: "" },
        ...props.members.map((m) => ({ label: m.fullName ?? m.email, value: m.userId })),
      ],
    }),
  );

  const current = () => props.issue.assignee?.id ?? "";

  return (
    <Show
      when={can(props.session, props.org.id, "issues.assign")}
      fallback={props.issue.assignee?.fullName ?? props.issue.assignee?.email ?? "—"}
    >
      <Select.Root
        size="sm"
        width="9.5rem"
        collection={collection()}
        disabled={pending()}
        value={[current()]}
        onValueChange={(d) => {
          const next = d.value[0] ?? "";
          if (next === current()) return;
          setPending(true);
          void runMutation(props, "Could not change the assignee.", () =>
            assignIssue({
              orgSlug: props.orgSlug,
              issueId: props.issue.id,
              assigneeId: next || null,
            }),
          ).finally(() => setPending(false));
        }}
        positioning={{ sameWidth: true }}
      >
        <Select.Label srOnly>Assignee for {issueKey(props.issue)}</Select.Label>
        <Select.Control>
          {/*
            A person's name — or the address it falls back to — has no length
            limit, and the trigger is a fixed-width flex container whose child
            defaults to `min-width: auto`. Without the clamp a long address
            spills out of the control and counts towards the table's scroll
            width. `pe` keeps the ellipsis clear of the chevron, which is
            positioned over this text rather than beside it.
          */}
          <Select.Trigger overflow="hidden">
            <Select.ValueText truncate minW="0" pe="5" placeholder="Unassigned" />
            <Select.IndicatorGroup>
              <Select.Indicator>
                <ChevronsUpDown size={16} />
              </Select.Indicator>
            </Select.IndicatorGroup>
          </Select.Trigger>
        </Select.Control>
        <Portal>
          <Select.Positioner>
            <Select.Content>
              <For each={collection().items}>
                {(item) => (
                  <Select.Item item={item}>
                    <Select.ItemText>{item.label}</Select.ItemText>
                    <Select.ItemIndicator />
                  </Select.Item>
                )}
              </For>
            </Select.Content>
          </Select.Positioner>
        </Portal>
        <Select.HiddenSelect />
      </Select.Root>
    </Show>
  );
}

/**
 * Edit and Delete for one row. Renders nothing without `issues.write`.
 *
 * Belongs in a `data-actions` cell, which is what lifts the pair onto their own
 * line at the foot of the card below `lg`.
 */
export function IssueRowActions(props: IssueActionProps & { issue: IssueControlsIssue }) {
  return (
    <Show when={can(props.session, props.org.id, "issues.write")}>
      <HStack gap="2" justifyContent="flex-end">
        <IssueFormDialog
          mode="edit"
          issue={props.issue}
          session={props.session}
          org={props.org}
          orgSlug={props.orgSlug}
          onDone={props.onDone}
          onError={props.onError}
          trigger={(triggerProps) => (
            /*
              The accessible name carries the issue key because a table of rows
              otherwise offers a dozen buttons all called "Edit" — indistinguishable
              to a screen reader and ambiguous to a role-and-name locator. The
              visible word is still the start of the name, so the two agree.
            */
            <Button
              {...triggerProps()}
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Edit ${issueKey(props.issue)}`}
            >
              Edit
            </Button>
          )}
        />

        {/*
          Deleting an issue cannot be undone, so it asks first. The server does
          not — confirmation is an interface concern, not an authorization one.
        */}
        <ConfirmDialog
          title={`Delete ${issueKey(props.issue)}?`}
          description={
            <>
              “{props.issue.title}” is removed permanently, along with everything recorded
              against it. This cannot be undone.
            </>
          }
          confirmLabel="Delete issue"
          onConfirm={async () => {
            await runMutation(props, "Could not delete the issue.", () =>
              deleteIssue({ orgSlug: props.orgSlug, issueId: props.issue.id }),
            );
          }}
          trigger={(triggerProps) => (
            <Button
              {...triggerProps()}
              type="button"
              variant="ghost"
              size="sm"
              colorPalette="red"
              aria-label={`Delete ${issueKey(props.issue)}`}
            >
              Delete
            </Button>
          )}
        />
      </HStack>
    </Show>
  );
}

interface IssueFormDialogBase extends IssueActionProps {
  /** The button that opens the dialog. Same render-prop shape as ConfirmDialog. */
  trigger: IssueTriggerRender;
}

export type IssueFormDialogProps =
  | (IssueFormDialogBase & {
      mode: "create";
      /** The project the issue lands in, when the screen already knows it. */
      projectId?: string;
      /**
       * Offer a project picker instead. The issues list spans projects, so it
       * has to ask; a project's own screen passes `projectId` and omits this.
       */
      projects?: IssueProjectOption[];
    })
  | (IssueFormDialogBase & { mode: "edit"; issue: IssueControlsIssue });

/** Create or edit an issue. Renders nothing without `issues.write`. */
export function IssueFormDialog(props: IssueFormDialogProps) {
  const [open, setOpen] = createSignal(false);

  return (
    <Show when={can(props.session, props.org.id, "issues.write")}>
      <Dialog.Root open={open()} onOpenChange={(d) => setOpen(d.open)}>
        <Dialog.Trigger asChild={props.trigger} />
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              {/*
                The form is a separate component so that Dialog.Root's
                lazyMount/unmountOnExit does the state resetting for us: every
                opening mounts a fresh copy, so a half-typed title abandoned on
                one row cannot reappear on the next.
              */}
              <IssueForm
                mode={props.mode}
                issue={props.mode === "edit" ? props.issue : undefined}
                projects={props.mode === "create" ? props.projects : undefined}
                projectId={props.mode === "create" ? props.projectId : undefined}
                orgSlug={props.orgSlug}
                onDone={props.onDone}
                onError={props.onError}
                onClose={() => setOpen(false)}
              />
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Show>
  );
}

/**
 * Park UI has no generated textarea in this project and this dialog is its only
 * user, so the recipe is applied here rather than adding a component nothing
 * else imports. Ark's `Field.Textarea` rather than a bare element, so the label
 * and helper text wire up the way they do for every other field.
 */
const Textarea = styled(ArkField.Textarea, textarea);

function IssueForm(props: {
  mode: "create" | "edit";
  issue?: IssueControlsIssue;
  projects?: IssueProjectOption[];
  projectId?: string;
  orgSlug: string;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError?: (message: string) => void;
}) {
  /*
   * Read once at mount, which — thanks to unmountOnExit above — is once per
   * opening of the dialog. Signals initialised from props would otherwise be a
   * one-way snapshot that quietly went stale.
   */
  const initialDescription = props.issue?.description ?? "";

  const [title, setTitle] = createSignal(props.issue?.title ?? "");
  const [description, setDescription] = createSignal(initialDescription);
  const [priority, setPriority] = createSignal<IssuePriority>(props.issue?.priority ?? "none");
  const [projectId, setProjectId] = createSignal(props.projectId ?? "");
  const [pending, setPending] = createSignal(false);

  const projectCollection = createMemo(() =>
    createListCollection({
      items: (props.projects ?? []).map((p) => ({ label: `${p.key} · ${p.name}`, value: p.id })),
    }),
  );

  const editing = () => props.mode === "edit";
  const needsProject = () => props.mode === "create" && !!props.projects;
  /** The list payload has no description, so editing starts from nothing known. */
  const descriptionUnknown = () => editing() && props.issue?.description === undefined;
  const descriptionChanged = () => description() !== initialDescription;

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    const issue = props.issue;
    setPending(true);

    const saved =
      props.mode === "edit" && issue
        ? await runMutation(props, "Could not save the issue.", () =>
            updateIssue({
              orgSlug: props.orgSlug,
              issueId: issue.id,
              title: title(),
              priority: priority(),
              /*
                Sent only when the user actually typed. The box starts empty
                because the list does not carry descriptions, so sending it
                every time would wipe the stored text on any other edit —
                `updateIssue` leaves an absent key alone.
              */
              ...(descriptionChanged() ? { description: description().trim() || null } : {}),
            }),
          )
        : await runMutation(props, "Could not create the issue.", () =>
            createIssue({
              orgSlug: props.orgSlug,
              projectId: projectId(),
              title: title(),
              description: description().trim() || null,
              priority: priority(),
            }),
          );

    setPending(false);
    if (saved) props.onClose();
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack gap="6" p="6">
        <Stack gap="2">
          <Dialog.Title>
            {editing() && props.issue ? `Edit ${issueKey(props.issue)}` : "New issue"}
          </Dialog.Title>
          <Dialog.Description>
            <Text color="fg.muted">
              {editing()
                ? "Title, description and priority. Status and assignee are changed from the row itself."
                : "Only a title is required — everything else can be filled in later."}
            </Text>
          </Dialog.Description>
        </Stack>

        <Stack gap="4">
          <Show when={needsProject()}>
            {/* Stacked so the note below sits with its control rather than
                inheriting the form's larger inter-field gap. */}
            <Stack gap="1.5">
            <Select.Root
              size="sm"
              collection={projectCollection()}
              value={projectId() ? [projectId()] : []}
              onValueChange={(d) => setProjectId(d.value[0] ?? "")}
              positioning={{ sameWidth: true }}
            >
              <Select.Label>Project</Select.Label>
              <Select.Control>
                {/* Same clamp as the assignee picker: a project name is data. */}
                <Select.Trigger overflow="hidden">
                  <Select.ValueText truncate minW="0" pe="5" placeholder="Choose a project" />
                  <Select.IndicatorGroup>
                    <Select.Indicator>
                      <ChevronsUpDown size={16} />
                    </Select.Indicator>
                  </Select.IndicatorGroup>
                </Select.Trigger>
              </Select.Control>
              {/*
                Not portalled, unlike the pickers in the table: the dialog traps
                focus, and a listbox rendered outside it would be unreachable
                from the keyboard. Inside a dialog there is nothing to escape.
              */}
              <Select.Positioner>
                <Select.Content>
                  <For each={projectCollection().items}>
                    {(item) => (
                      <Select.Item item={item}>
                        <Select.ItemText>{item.label}</Select.ItemText>
                        <Select.ItemIndicator />
                      </Select.Item>
                    )}
                  </For>
                </Select.Content>
              </Select.Positioner>
              <Select.HiddenSelect />
            </Select.Root>
            {/*
              An issue has to live in a project, so with none to choose the
              submit button below is disabled — say why rather than leaving a
              dead button and an empty list.
            */}
            <Show when={projectCollection().items.length === 0}>
              <Text fontSize="sm" color="fg.muted">
                There are no projects yet. Create one first and the issue can go in it.
              </Text>
            </Show>
            </Stack>
          </Show>

          <Field.Root required>
            <Field.Label>Title</Field.Label>
            <Input
              size="sm"
              value={title()}
              onInput={(e) => setTitle(e.currentTarget.value)}
              placeholder="What needs doing?"
              maxlength={200}
              required
            />
          </Field.Root>

          <Field.Root>
            <Field.Label>Description</Field.Label>
            <Textarea
              size="sm"
              rows={4}
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
              placeholder="Context, steps to reproduce, links…"
              maxlength={10000}
            />
            <Show when={descriptionUnknown()}>
              <Field.HelperText>
                The list does not load descriptions, so this starts empty. Leave it alone to keep
                what is stored; anything you type replaces it.
              </Field.HelperText>
            </Show>
          </Field.Root>

          <Select.Root
            size="sm"
            collection={priorityCollection}
            value={[priority()]}
            onValueChange={(d) => setPriority((d.value[0] as IssuePriority | undefined) ?? "none")}
            positioning={{ sameWidth: true }}
          >
            <Select.Label>Priority</Select.Label>
            <Select.Control>
              <Select.Trigger>
                <Select.ValueText />
                <Select.IndicatorGroup>
                  <Select.Indicator>
                    <ChevronsUpDown size={16} />
                  </Select.Indicator>
                </Select.IndicatorGroup>
              </Select.Trigger>
            </Select.Control>
            <Select.Positioner>
              <Select.Content>
                <For each={priorityCollection.items}>
                  {(item) => (
                    <Select.Item item={item}>
                      <Select.ItemText>{item.label}</Select.ItemText>
                      <Select.ItemIndicator />
                    </Select.Item>
                  )}
                </For>
              </Select.Content>
            </Select.Positioner>
            <Select.HiddenSelect />
          </Select.Root>
        </Stack>

        <HStack gap="3" justifyContent="flex-end">
          <Dialog.CloseTrigger
            asChild={(closeProps) => (
              <Button {...closeProps()} type="button" variant="outline">
                Cancel
              </Button>
            )}
          />
          {/*
            A create with no project would be rejected by the endpoint, so the
            button stays out of reach until one is chosen rather than offering a
            round trip that can only fail.
          */}
          <Button type="submit" loading={pending()} disabled={needsProject() && !projectId()}>
            {editing() ? "Save changes" : "Create issue"}
          </Button>
        </HStack>
      </Stack>
    </form>
  );
}
