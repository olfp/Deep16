#!/usr/bin/env bash
# scripts/flash_gowin_tile_flash.sh - persistent tile build via openFPGALoader.
#
# One command writes the whole config flash:
#   -f <tile .fs>             FPGA configuration at 0
#   -o 0x100000 <boot .bin>   the D16D kernel + showcase boot image
#   -o 0x200000 <slices.bin>  the source slices (upper, writable half)
#
# The boot image is at 1 MB, inside the 2 MB block protect, so a slice
# writer cannot corrupt it. Both survive a power cycle. This is the tested
# route on the Tang Nano 9K; the on-die 608 Kbit user flash is no longer used
# by the tile build.
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

# The P25Q32H block protect is not cleared by --unprotect-flash: RDSR stays
# 0x38 and the raw write at 0x100000 is silently dropped. Run `cf-unprotect` on
# the board (cf-status must read 0) before this script.
echo "NOTE: run 'cf-unprotect' on the board first; --unprotect-flash does not clear this chip's BP."
openFPGALoader --unprotect-flash -f "$FS"
openFPGALoader -f --external-flash --file-type bin -o 0x100000 "$USER"

# Verify the boot image actually landed before writing the slices. A protected
# chip still reports "Done" for the dropped write, so compare the dump.
TMP=$(mktemp /tmp/de16boot.XXXXXX)
if ! openFPGALoader --dump-flash --file-size 0x13000 --external-flash       -o 0x100000 "$TMP" >/dev/null 2>&1 || ! cmp -s "$TMP" "$USER"; then
  rm -f "$TMP"
  echo "ERROR: boot image at 0x100000 does not match (BP is probably set)." >&2
  echo "Run 'cf-unprotect' on the board, then rerun npm run flash:tile." >&2
  echo "The bitstream is already written; the installer fallback can restore a booting board." >&2
  exit 1
fi
rm -f "$TMP"

# The slices go last: the bitstream/boot writes must not disturb them.
bash "$ROOT/scripts/flash_slices.sh"

echo
echo "configuration + boot image (1 MB) + slices written."
echo "power-cycle the board: it boots into the D16D menu (Flappy / Forth / autorun)."
