import { defineConfig } from "@pandacss/dev";

/**
 * Panda CSS, pre-configured for Park UI.
 *
 * `npx @park-ui/cli init` will extend this file (adding its preset and the
 * chosen accent/gray palettes). The pieces below are the ones that must be in
 * place beforehand:
 *
 *   - jsxFramework: "solid"  — so generated components target Solid, not React
 *   - the preset-colors plugin — Park UI ships its own Radix-based color
 *     system, and leaving Panda's defaults in place produces two competing
 *     sets of color tokens
 */
export default defineConfig({
  preflight: true,
  include: ["./src/**/*.{js,jsx,ts,tsx}"],
  exclude: [],
  jsxFramework: "solid",
  outdir: "styled-system",
  theme: {
    extend: {},
  },
  plugins: [
    {
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
