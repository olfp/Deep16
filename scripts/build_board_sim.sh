#!/usr/bin/env bash
# Build and run the D16MINI board build on Verilator.
#
# The bring-up path without a board and without Gowin: the 26-block window, the
# boot image, the window decode and the UART pins *both ways* - it waits for the
# banner, then types a line into the receive pin and checks that it comes back
# echoed and evaluated. The image is regenerated first, so what runs is what the
# bitstream would hold.
#
# `npm run sim:board` (or scripts/build_board_sim.sh [expected-banner]).
set -euo pipefail

cd "$(dirname "$0")/.."

# The image must be in the working directory: $readmemh resolves at run time.
node scripts/make_image.mjs

RTL_SOURCES=(
  rtl/deep16_pkg.sv
  rtl/deep16_alu.sv
  rtl/deep16_regfile.sv
  rtl/deep16_cache.sv
  rtl/deep16_divider.sv
  rtl/deep16_uart.sv
  rtl/deep16_core.sv
  rtl/deep16_top.sv
  rtl/deep16_board.sv
)

verilator --cc --exe --build -O2 -Wall -DD16MINI \
  --top-module deep16_board \
  -Mdir obj_board \
  "${RTL_SOURCES[@]}" \
  rtl/sim/board_tb.cpp \
  -o deep16_board_tb

ROOT="$(pwd)"
cd artifacts/image
"$ROOT/obj_board/deep16_board_tb" "$@"
