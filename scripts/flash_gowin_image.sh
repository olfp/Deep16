#!/usr/bin/env bash
# scripts/flash_gowin_image.sh - fast firmware/slice update (no bitstream).
#
# Writes the D16D boot image at 0x100000 and the source slices at 0x200000.
# The FPGA bitstream at 0 is left alone, so this is much faster than
# `npm run flash:tile` and does not need the bitstream synthesis stamp.
#
# Use this after kernel/BIOS/Forth/sample changes. Use `npm run flash:slices`
# when only the slice sources changed, and `npm run flash:tile` only when the
# RTL/bitstream changed.
#
# The boot image lives in the lower 2 MB, which the P25Q32H can block-protect.
# This script assumes BP is clear (the development board is unprotected). If
# `cf-status` on the board is not 0, run `cf-unprotect` first.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
USER="$ROOT/artifacts/image/image.flash.bin"

D16NANO=1 D16D=1 D16SEG=1 node "$ROOT/scripts/make_image.mjs" >/dev/null
command -v openFPGALoader >/dev/null 2>&1 || { echo "openFPGALoader not found" >&2; exit 1; }
[ -f "$USER" ] || { echo "missing $USER - run npm run image first" >&2; exit 1; }

openFPGALoader -f --external-flash --file-type bin -o 0x100000 "$USER"

TMP=$(mktemp /tmp/de16boot.XXXXXX)
if ! openFPGALoader --dump-flash --file-size 0x13000 --external-flash \
       -o 0x100000 "$TMP" >/dev/null 2>&1 || ! cmp -s "$TMP" "$USER"; then
  rm -f "$TMP"
  echo "ERROR: boot image at 0x100000 does not match (BP is probably set)." >&2
  echo "Run 'cf-unprotect' on the board, then rerun npm run flash:image." >&2
  exit 1
fi
rm -f "$TMP"

bash "$ROOT/scripts/flash_slices.sh"

echo
echo "boot image + slices written (bitstream untouched)."
echo "power-cycle the board: it boots into the D16D menu (Flappy / Forth / autorun)."
