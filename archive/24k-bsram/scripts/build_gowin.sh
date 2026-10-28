#!/usr/bin/env bash
# scripts/build_gowin.sh - run the D16MINI board build through the Gowin EDA
# vendor toolchain (D16MINI.md §10, the residue item).
#
#   npm run synth:gowin
#
# Needs Gowin EDA installed. Default /Applications/GowinIDE.app; override with
# GOWIN_APP for another location or version.
#
# Two macOS specific facts are handled here, both found the hard way:
#
#  * gw_sh links @rpath Qt/Tcl dylibs that only resolve with DYLD_LIBRARY_PATH
#    and DYLD_FRAMEWORK_PATH pointing at <app>/Contents/Resources/Gowin_EDA/
#    IDE/lib. Without them it dies on libGWTE.dylib, then Tcl.framework. The
#    bundle ships Contents/Resources/env.zshrc which exports exactly this.
#    They are scoped to the gw_sh call only: Gowin's IDE/lib holds its own
#    libcrypto.3.dylib, and exporting the path globally makes Homebrew's node
#    load that instead and abort with a missing symbol.
#  * the project is opened from the committed .gprj (relative paths), so the
#    working directory does not matter.
#
# The boot image is regenerated first: it is a synthesis input ($readmemh), not
# a runtime load (D16MINI.md §6.2.1).
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

GOWIN_APP="${GOWIN_APP:-/Applications/GowinIDE.app}"
GOWIN_EDA="$GOWIN_APP/Contents/Resources/Gowin_EDA/IDE"
GW_SH="$GOWIN_EDA/bin/gw_sh"

if [ ! -x "$GW_SH" ]; then
  echo "gw_sh not found: $GW_SH" >&2
  echo "Install Gowin EDA or set GOWIN_APP to the .app bundle." >&2
  exit 1
fi

node scripts/make_image.mjs

export DEEP16_ROOT="$ROOT"

DYLD_LIBRARY_PATH="$GOWIN_EDA/lib" \
DYLD_FRAMEWORK_PATH="$GOWIN_EDA/lib" \
  "$GW_SH" "$ROOT/fpga/gowin/build.tcl"
