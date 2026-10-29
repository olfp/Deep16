#!/usr/bin/env bash
# scripts/flash_gowin_tile_flash.sh - persistent tile build via openFPGALoader.
#
# One command writes both halves:
#   -f <tile .fs>            FPGA configuration (external config flash)
#   --user-flash <raw .bin>  on-die 608 Kbit user flash (D16D kernel + showcase)
#
# Both survive a power cycle. This is the tested route on the Tang Nano 9K;
# the Gowin Embedded Flash Mode GUI is an alternative, and the
# deep16_installer.fs remains the fallback for the user-flash half.
#
# The .fs and the image.flash.bin must come from the same D16D build:
#   npm run synth:tile
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
FS="$ROOT/fpga/gowin/impl/pnr/deep16_board_tile_flash.fs"
USER="$ROOT/artifacts/image/image.flash.bin"

# Regenerate the D16D user image so a prior standard make_image cannot leave a
# mismatched kernel next to the tile configuration.
D16NANO=1 D16D=1 D16SEG=1 node "$ROOT/scripts/make_image.mjs" >/dev/null
command -v openFPGALoader >/dev/null 2>&1 || { echo "openFPGALoader not found" >&2; exit 1; }
[ -f "$FS" ]   || { echo "missing $FS - run npm run synth:tile first" >&2; exit 1; }
[ -f "$USER" ] || { echo "missing $USER - run npm run synth:tile first" >&2; exit 1; }

openFPGALoader --unprotect-flash -f "$FS" --user-flash "$USER"

echo
echo "configuration + on-die user flash written."
echo "power-cycle the board: it boots into the D16D menu (Flappy / Forth / autorun)."
