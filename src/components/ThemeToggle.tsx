import { Moon, Sun } from "lucide-solid";
import { createSignal, onMount, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { applyColorMode, currentColorMode, type ColorMode } from "~/lib/theme";

/**
 * Light/dark switch.
 *
 * The initial value is read in `onMount` rather than during render because the
 * server has no idea which mode this visitor is in — the class is applied by an
 * inline script in the browser. Rendering a guess would produce a hydration
 * mismatch, so the icon is withheld for the one frame it takes to look.
 */
export function ThemeToggle() {
  const [mode, setMode] = createSignal<ColorMode | null>(null);

  onMount(() => setMode(currentColorMode()));

  function toggle() {
    const next: ColorMode = mode() === "dark" ? "light" : "dark";
    applyColorMode(next);
    setMode(next);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-label={mode() === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title="Toggle theme"
    >
      <Show when={mode()} fallback={<span style={{ width: "1rem", height: "1rem" }} />}>
        <Show when={mode() === "dark"} fallback={<Moon size={16} />}>
          <Sun size={16} />
        </Show>
      </Show>
    </Button>
  );
}
