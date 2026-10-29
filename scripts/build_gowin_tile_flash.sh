#!/usr/bin/env bash
# scripts/build_gowin_tile_flash.sh - build the persistent USER_FLASH tile build.
#
# The 16 BSRAM-block CPU image is replaced by the config-flash boot copy at
# 0x100000, which frees the blocks the PSRAM tag cache and the 128-tile sprite
# bank need. The D16D showcase is in the 24K image's BIOS segment; the boot
# image is the full 608 Kbit image.flash.bin.
#
# This target builds the .fs and writes image.flash.bin; flash the pair with:
#   npm run flash:tile
# which runs, and then power-cycle:
#   openFPGALoader -f <tile.fs> --user-flash artifacts/image/image.flash.bin
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
GOWIN_APP="${GOWIN_APP:-/Applications/GowinIDE.app}"
GOWIN_EDA="$GOWIN_APP/Contents/Resources/Gowin_EDA/IDE"
GW_SH="$GOWIN_EDA/bin/gw_sh"
[ -x "$GW_SH" ] || { echo "gw_sh not found: $GW_SH" >&2; exit 1; }

D16NANO=1 D16D=1 D16SEG=1 node scripts/make_image.mjs

export DEEP16_ROOT="$ROOT"
DYLD_LIBRARY_PATH="$GOWIN_EDA/lib" \
DYLD_FRAMEWORK_PATH="$GOWIN_EDA/lib" \
  "$GW_SH" "$ROOT/fpga/gowin/build_tile_flash.tcl"

echo "tile configuration: fpga/gowin/impl/pnr/deep16_board_tile_flash.fs"
echo "boot image:          artifacts/image/image.flash.bin (608 Kbit, config flash 0x100000)"
echo "flash all three with: npm run flash:tile   (then power-cycle)"
