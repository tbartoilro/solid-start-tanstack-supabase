/**
 * Colour-mode handling.
 *
 * Panda emits dark styles under a `.dark` class on the document element, so
 * something has to put it there. The rules:
 *
 *   - an explicit choice, once made, wins and is remembered
 *   - otherwise follow the operating system, and keep following it if it changes
 *
 * The class is applied by an inline script in the SSR document head (see
 * entry-server.tsx) so it is set before first paint. Doing it in a component
 * effect instead would render the light theme first and repaint — the flash of
 * wrong theme that this exists to avoid.
 */
export type ColorMode = "light" | "dark";

export const THEME_STORAGE_KEY = "color-mode";

/** Source of truth, read from the DOM rather than a duplicated signal. */
export function currentColorMode(): ColorMode {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyColorMode(mode: ColorMode): void {
  document.documentElement.classList.toggle("dark", mode === "dark");
  document.documentElement.style.colorScheme = mode;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Private browsing or a blocked storage partition. The toggle still works
    // for this page; it simply will not be remembered.
  }
}

/**
 * The script inlined into <head>. Kept as a single expression string so the
 * document stays readable and the logic lives next to the helpers above.
 *
 * Deliberately tolerant: any failure falls through to the light theme rather
 * than throwing during head parsing, which would block the rest of the page.
 */
export const COLOR_MODE_BOOT_SCRIPT = `
try {
  var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
  var dark = stored ? stored === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
} catch (e) {}
`.trim();
