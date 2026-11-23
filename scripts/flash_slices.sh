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

node scripts/make_slices.mjs ${SLICES_WITHOUT_POLE:+--without-pole}
command -v openFPGALoader >/dev/null 2>&1 || { echo "openFPGALoader not found" >&2; exit 1; }

openFPGALoader -f --external-flash --file-type bin \
    -o 0x200000 artifacts/image/slices.bin

# Verify the slice write too. The boot-image check in flash_gowin_tile_flash.sh
# says nothing about the upper half: a protected or dropped slice write leaves
# the menu working (it lives in the boot image) while games and Forth fail.
SIZE=$(wc -c < artifacts/image/slices.bin | tr -d ' ')
TMP=$(mktemp /tmp/de16slices.XXXXXX)
if ! openFPGALoader --dump-flash --file-size "$(printf '0x%x' "$SIZE")" \
        --external-flash -o 0x200000 "$TMP" >/dev/null 2>&1 ||
   ! cmp -s "$TMP" artifacts/image/slices.bin; then
    rm -f "$TMP"
    echo "ERROR: slice image at 0x200000 does not match (block protect?)." >&2
    echo "The boot image was written; clear the upper-half protect and rerun." >&2
    exit 1
fi
rm -f "$TMP"

echo
echo "slice image written and verified at 0x200000 (upper 2 MB, bitstream untouched)."
