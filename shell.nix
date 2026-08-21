{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = [ pkgs.nodejs_26 pkgs.chromium ];

  # Both browser MCP servers drive this Nix-built Chromium over CDP.
  # Playwright's own bundled builds are generic Linux binaries that expect
  # libraries at FHS paths NixOS does not provide, so they fail to launch here.
  CHROMIUM_PATH = "${pkgs.chromium}/bin/chromium";
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
}
