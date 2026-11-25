#!/usr/bin/env bash
# Build and run the PS/2 receiver test.
#
# The receiver emits raw make events; there is no $readmemh map any more.
set -euo pipefail

cd "$(dirname "$0")/.."

verilator --cc --exe --build -O2 -Wall --top-module ps2_rx_tb \
  -Mdir obj_ps2 \
  rtl/ps2_rx.sv rtl/sim/ps2_rx_tb.sv rtl/sim/ps2_rx_tb.cpp \
  -o ps2_rx_tb

"$PWD/obj_ps2/ps2_rx_tb"
