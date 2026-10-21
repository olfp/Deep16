#!/usr/bin/env bash
# scripts/flash_gowin_flash.sh - persistent USER_FLASH config via the Gowin CLI.
#
# Writes the *configuration* to the external SPI flash in bscan mode and leaves
# the on-die FLASH608K image alone. This is the CLI equivalent of the Gowin
# Programmer's External Flash operation, without the GUI.
#
# Why not openFPGALoader: its .fs parser writes the user-flash section, so the
# USER_FLASH .fs boots only in SRAM. Its --user-flash option is LittleBee-only.
#
# The board's USB-JTAG cable is the FT2CH (--cable-index 1). Takes ~3.5 minutes.
# The on-die image is installed separately, once, with:
#   openFPGALoader -m fpga/gowin/impl/pnr/deep16_installer.fs
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
GOWIN_APP="${GOWIN_APP:-/Applications/GowinIDE.app}"
PROGRAMMER="$GOWIN_APP/Contents/Resources/Gowin_EDA/Programmer/bin/programmer_cli"
FS="$ROOT/fpga/gowin/impl/pnr/deep16_board_flash.fs"
[ -x "$PROGRAMMER" ] || { echo "programmer_cli not found: $PROGRAMMER" >&2; exit 1; }
[ -f "$FS" ] || { echo "missing $FS - run npm run synth:flash first" >&2; exit 1; }

DYLD_LIBRARY_PATH="$GOWIN_APP/Contents/Resources/Gowin_EDA/IDE/lib" \
DYLD_FRAMEWORK_PATH="$GOWIN_APP/Contents/Resources/Gowin_EDA/IDE/lib" \
  "$PROGRAMMER" \
    --device GW1NR-9C \
    --run 13 \
    --fsFile "$FS" \
    --cable-index 1

echo
echo "final written to the external config flash."
echo "power-cycle (or run: programmer_cli --device GW1NR-9C --run 1 --cable-index 1)."
echo "if LED0 is steady lit, the on-die image is missing: run the installer with -m."
