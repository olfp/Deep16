#!/usr/bin/env bash
# scripts/flash_slices.sh - write the config-flash slice image.
#
# The slices live in the upper, writable half of the on-board P25Q32U:
#   slice n at 0x200000 + n * 0x1000     (sector 512 + n)
# Slice 0 is the master directory; scripts/make_slices.mjs builds the image
# from screens/flash/*.fth. The lower half (bitstream + boot image at 0x100000)
# is untouched, so this is safe with the BP = 0x38 / lower-2-MB block protect
# in place.
#
# `--external-flash` is what makes openFPGALoader accept a raw .bin and write
# the board's SPI flash through the FPGA's BSCAN bridge; `-f` selects flash
# mode. Without --external-flash it insists on a Gowin .fs bitstream.
#
# The FPGA configuration and the on-die user flash are not written here; use
# `npm run flash:tile` for a full update, or cf-unprotect first if the
# bitstream has to change.
set -euo pipefail
cd "$(dirname "$0")/.."

node scripts/make_slices.mjs
command -v openFPGALoader >/dev/null 2>&1 || { echo "openFPGALoader not found" >&2; exit 1; }

openFPGALoader -f --external-flash --file-type bin \
    -o 0x200000 artifacts/image/slices.bin

echo
echo "slice image written at 0x200000 (upper 2 MB, bitstream untouched)."
