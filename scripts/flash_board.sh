#!/usr/bin/env bash
# scripts/flash_board.sh - program the Tang Nano 9K with the D16MINI bitstream.
#
#   npm run flash              # write the external config flash (persistent)
#   npm run flash -- --sram    # load SRAM only (volatile, quick to iterate)
#
# openFPGALoader drives the board's FT2232 directly and is the route that works
# here (D16MINI.md §4.7): the Gowin Programmer's GAO-bridge flash mode is fussy
# and wants the *binary* bitstream (deep16_board.bin), while openFPGALoader
# takes the text one. Needs openFPGALoader >= 0.13.1 for this board's external
# flash; v1.2.0 was verified, and it detects the part as GW1N(R)-9C.
#
# Writing the flash takes a while and the board only reconfigures at power-up,
# so unplug/replug when it finishes; `--sram` takes effect immediately.
set -euo pipefail

cd "$(dirname "$0")/.."

FS="fpga/gowin/impl/pnr/deep16_board.fs"
SRAM=0
for arg in "$@"; do
  [ "$arg" = "--sram" ] && SRAM=1
done

if ! command -v openFPGALoader >/dev/null 2>&1; then
  echo "openFPGALoader not found - 'brew install openfpgaloader'" >&2
  exit 1
fi

if [ ! -f "$FS" ]; then
  echo "no bitstream at $FS - run 'npm run synth:gowin' first" >&2
  exit 1
fi

if [ "$SRAM" = 1 ]; then
  echo "loading SRAM: $FS"
  openFPGALoader -b tangnano9k "$FS"
else
  echo "writing external flash: $FS"
  openFPGALoader -b tangnano9k -f "$FS"
  echo "done - power-cycle the board to boot from flash"
fi
