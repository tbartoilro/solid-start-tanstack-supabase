import { createSignal, type ComponentProps, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { HStack, Stack } from "styled-system/jsx";
import { Button } from "~/components/ui/button";
import * as Dialog from "~/components/ui/dialog";
import { Text } from "~/components/ui/text";

/**
 * Confirmation gate for a destructive action.
 *
 * Deleting a project takes its issues with it and cannot be undone, so it
 * should not be one stray click away. The server does not — and should not —
 * ask twice; this is purely about not letting the interface make an
 * irreversible request on a misclick.
 */
/**
 * Exactly the render-prop signature Ark's `asChild` expects. Derived from the
 * component rather than hand-written, so it cannot drift as Ark evolves.
 */
type TriggerRender = NonNullable<ComponentProps<typeof Dialog.Trigger>["asChild"]>;

export function ConfirmDialog(props: {
  trigger: TriggerRender;
  title: string;
  description: JSX.Element;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [open, setOpen] = createSignal(false);
  const [pending, setPending] = createSignal(false);

  async function confirm() {
    setPending(true);
    try {
      await props.onConfirm();
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root open={open()} onOpenChange={(d) => setOpen(d.open)} role="alertdialog">
      <Dialog.Trigger asChild={props.trigger} />
      {/*
        Portalled to <body>. Without this Ark renders the dialog exactly where
        the trigger sits — which here is a `<td textAlign="right">`, so the
        title and body text silently inherited right alignment. Escaping the
        table also keeps the dialog out of the cell's stacking and overflow
        context, so it cannot be clipped by the table's own scroll container.
      */}
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Stack gap="6" p="6">
            <Stack gap="2">
              <Dialog.Title>{props.title}</Dialog.Title>
              <Dialog.Description>
                <Text color="fg.muted">{props.description}</Text>
              </Dialog.Description>
            </Stack>
            <HStack gap="3" justifyContent="flex-end">
              <Dialog.CloseTrigger
                asChild={(closeProps) => (
                  <Button {...closeProps()} variant="outline">
                    Cancel
                  </Button>
                )}
              />
              <Button colorPalette="red" loading={pending()} onClick={() => void confirm()}>
                {props.confirmLabel}
              </Button>
            </HStack>
          </Stack>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
