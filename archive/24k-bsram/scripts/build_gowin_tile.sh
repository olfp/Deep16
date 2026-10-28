#!/usr/bin/env bash
# scripts/build_gowin_tile.sh - packed-image tile build (console experiment).
#
# The 8x32/128-tile sprite engine does not fit the packed image: the bank and
# the PSRAM tag cache compete for the 16 blocks the image occupies. The real
# tile build is scripts/build_gowin_tile_flash.sh (`npm run synth:tile`); this
# script is kept for the console-only experiment.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

GOWIN_APP="${GOWIN_APP:-/Applications/GowinIDE.app}"
GOWIN_EDA="$GOWIN_APP/Contents/Resources/Gowin_EDA/IDE"
GW_SH="$GOWIN_EDA/bin/gw_sh"

if [ ! -x "$GW_SH" ]; then
  echo "gw_sh not found: $GW_SH" >&2
  exit 1
fi

D16NANO=1 node scripts/make_image.mjs

export DEEP16_ROOT="$ROOT"

DYLD_LIBRARY_PATH="$GOWIN_EDA/lib" \
DYLD_FRAMEWORK_PATH="$GOWIN_EDA/lib" \
  "$GW_SH" "$ROOT/fpga/gowin/build_tile.tcl"

echo "tile-console bitstream: fpga/gowin/impl/pnr/deep16_board_tile.fs"
