#!/usr/bin/env bash
# scripts/build_gowin_flash.sh - build the final USER_FLASH machine.
#
# No boot image is baked into BSRAM: the loader reads it from the on-die
# FLASH608K (installed once by deep16_installer.fs). Flash the installer first,
# wait for LED1, then flash this bitstream.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
GOWIN_APP="${GOWIN_APP:-/Applications/GowinIDE.app}"
GOWIN_EDA="$GOWIN_APP/Contents/Resources/Gowin_EDA/IDE"
GW_SH="$GOWIN_EDA/bin/gw_sh"
[ -x "$GW_SH" ] || { echo "gw_sh not found: $GW_SH" >&2; exit 1; }
node scripts/make_image.mjs
export DEEP16_ROOT="$ROOT"
DYLD_LIBRARY_PATH="$GOWIN_EDA/lib" \
DYLD_FRAMEWORK_PATH="$GOWIN_EDA/lib" \
  "$GW_SH" "$ROOT/fpga/gowin/build_flash.tcl"
echo "user-flash bitstream: fpga/gowin/impl/pnr/deep16_board_flash.fs"
