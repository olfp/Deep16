#!/usr/bin/env bash
# scripts/flash_gowin_flash.sh - persistent standard build via openFPGALoader.
#
# One command writes both halves:
#   -f <standard .fs>        FPGA configuration (external config flash)
#   --user-flash <raw .bin>  on-die 608 Kbit user flash (D16 kernel image)
#
# Both survive a power cycle. The .fs and image.flash.bin must come from the
# same standard build:
#   npm run synth:flash
#
# The deep16_installer.fs remains the fallback for the user-flash half.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
FS="$ROOT/fpga/gowin/impl/pnr/deep16_board_flash.fs"
USER="$ROOT/artifacts/image/image.flash.bin"

# Regenerate the standard user image so it matches this standard configuration.
node "$ROOT/scripts/make_image.mjs" >/dev/null
command -v openFPGALoader >/dev/null 2>&1 || { echo "openFPGALoader not found" >&2; exit 1; }
[ -f "$FS" ]   || { echo "missing $FS - run npm run synth:flash first" >&2; exit 1; }
[ -f "$USER" ] || { echo "missing $USER - run npm run synth:flash first" >&2; exit 1; }

openFPGALoader -f "$FS" --user-flash "$USER"

echo
echo "configuration + on-die user flash written."
echo "power-cycle the board."
