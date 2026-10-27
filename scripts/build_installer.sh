#!/usr/bin/env bash
# scripts/build_installer.sh - build the one-time user-flash installer.
#
# The FLASH608K has no initial value and is not reachable from the Gowin
# programmer, so this bitstream is the only way to put the image into it. It
# loads image.flash.hex, erases the 25 pages it needs, programs the 12,352
# words, and verifies. With D16D=1 the image contains the D16D showcase in the
# BIOS segment, but the size and the installer are the same. LED1 steady = PASS;
# LED2 = FAIL.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
GOWIN_APP="${GOWIN_APP:-/Applications/GowinIDE.app}"
GOWIN_EDA="$GOWIN_APP/Contents/Resources/Gowin_EDA/IDE"
GW_SH="$GOWIN_EDA/bin/gw_sh"
[ -x "$GW_SH" ] || { echo "gw_sh not found: $GW_SH" >&2; exit 1; }
if [ "${D16D:-0}" = "1" ]; then
  # The D16D showcase is part of the 24K image (BIOS segment), so the plain
  # 25-page / 12,352-word installer is the matching one; no 32K/33-page variant.
  D16NANO=1 D16D=1 node scripts/make_image.mjs
  TCL="$ROOT/fpga/gowin/build_installer.tcl"
  OUT="deep16_installer"
else
  D16NANO="${D16NANO:-}" node scripts/make_image.mjs
  TCL="$ROOT/fpga/gowin/build_installer.tcl"
  OUT="deep16_installer"
fi
export DEEP16_ROOT="$ROOT"
DYLD_LIBRARY_PATH="$GOWIN_EDA/lib" \
DYLD_FRAMEWORK_PATH="$GOWIN_EDA/lib" \
  "$GW_SH" "$TCL"
echo "installer bitstream: fpga/gowin/impl/pnr/$OUT.fs"
