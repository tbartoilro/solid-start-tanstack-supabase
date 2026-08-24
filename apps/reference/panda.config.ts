import { defineConfig } from "@pandacss/dev";
import { createPreset } from "@park-ui/panda-preset";
import blue from "@park-ui/panda-preset/colors/blue";
import slate from "@park-ui/panda-preset/colors/slate";

/**
 * Panda CSS + Park UI.
 *
 * Written by hand rather than by `@park-ui/cli init`, which is interactive-only
 * and cannot be scripted. The result is the same; doing it here keeps the
 * choice of palette and radius reviewable in the diff instead of buried in a
 * terminal session.
 *
 * `@park-ui/cli add <component>` still works against this config — it reads
 * `components.json` at the project root.
 */
export default defineConfig({
  preflight: true,
  include: ["./src/**/*.{js,jsx,ts,tsx}"],
  exclude: [],
  // Generates Solid components in styled-system/jsx, not React ones.
  jsxFramework: "solid",
  outdir: "styled-system",

  presets: [
    createPreset({
      accentColor: blue,
      grayColor: slate,
      radius: "md",
    }),
  ],

  theme: {
    extend: {
      /**
       * Bridge: Park UI preset 0.43.1 vs Ark UI v5.
       *
       * The published preset is built against @ark-ui/anatomy 3.5.0, while the
       * components `@park-ui/cli` generates target Ark UI v5 — which added slots
       * and recipes the preset does not know about yet. Without these the
       * generated components reference recipes/slots that do not exist and the
       * build fails.
       *
       * Everything below is additive. Drop it once the preset catches up to v5.
       */
      slotRecipes: {
        dialog: {
          slots: ["header", "body", "footer"],
          base: {
            header: { display: "flex", flexDirection: "column", gap: "1", pb: "4" },
            body: { flex: "1", display: "flex", flexDirection: "column", gap: "4" },
            footer: { display: "flex", justifyContent: "flex-end", gap: "3", pt: "6" },
          },
        },
        alert: {
          slots: ["indicator"],
          base: {
            indicator: { display: "inline-flex", flexShrink: "0", color: "colorPalette.default" },
          },
        },
        field: {
          slots: ["requiredIndicator"],
          base: { requiredIndicator: { color: "fg.error", ms: "0.5" } },
        },
        select: {
          slots: ["indicatorGroup", "content"],
          base: {
            indicatorGroup: {
              display: "inline-flex",
              alignItems: "center",
              gap: "1",
              pos: "absolute",
              insetEnd: "3",
              top: "0",
              bottom: "0",
              pointerEvents: "none",
            },
            /*
             * Bound the popup and let it scroll.
             *
             * Neither the preset nor Ark caps this, so the list is as tall as
             * its contents: an assignee picker for a 64-person organization
             * measured 2600px inside a 900px viewport, with everything past the
             * first dozen names below the fold and unreachable. It only looked
             * fine because the seed had four members.
             *
             * `--available-height` is published by the positioner (floating-ui
             * measures the space to the viewport edge), so the list grows to fit
             * whatever room the trigger has and stops there. The fallback covers
             * the first paint, before the variable is set.
             */
            content: {
              maxHeight: "min(20rem, var(--available-height, 20rem))",
              overflowY: "auto",
              // Stops a scroll gesture that reaches the end of the list from
              // continuing into the page behind it.
              overscrollBehavior: "contain",
            },
          },
        },
        table: {
          slots: ["foot"],
          base: { foot: { fontWeight: "medium", "& td": { color: "fg.muted" } } },
        },
      },

      recipes: {
        // Ark v5's Loader asks the Spinner for size="inherit" so it can match
        // the button text it sits beside.
        spinner: {
          variants: {
            size: { inherit: { width: "1em", height: "1em", borderWidth: "0.125em" } },
          },
        },

        heading: {
          className: "heading",
          base: { fontWeight: "semibold", color: "fg.default", lineHeight: "1.2" },
          defaultVariants: { size: "xl" },
          variants: {
            size: {
              sm: { fontSize: "sm" },
              md: { fontSize: "md" },
              lg: { fontSize: "lg" },
              xl: { fontSize: "xl" },
              "2xl": { fontSize: "2xl" },
              "3xl": { fontSize: "3xl" },
              "4xl": { fontSize: "4xl" },
            },
          },
        },

        group: {
          className: "group",
          base: { display: "inline-flex", alignItems: "center" },
          defaultVariants: { orientation: "horizontal", attached: false },
          variants: {
            orientation: {
              horizontal: { flexDirection: "row" },
              vertical: { flexDirection: "column" },
            },
            attached: { true: {}, false: { gap: "2" } },
            grow: { true: { display: "flex", "& > *": { flex: "1" } } },
          },
        },

        absoluteCenter: {
          className: "absoluteCenter",
          base: {
            pos: "absolute",
            top: "50%",
            insetStart: "50%",
            transform: "translate(-50%, -50%)",
          },
        },
      },
    },
  },

  plugins: [
    {
      // Park UI ships its own Radix-derived color system. Leaving Panda's
      // defaults in place would produce two competing sets of color tokens,
      // and semantic tokens like `fg.default` would resolve unpredictably.
      name: "Remove Panda Preset Colors",
      hooks: {
        "preset:resolved": ({ utils, preset, name }) =>
          name === "@pandacss/preset-panda"
            ? utils.omit(preset, ["theme.tokens.colors", "theme.semanticTokens.colors"])
            : preset,
      },
    },
  ],
});