#!/usr/bin/env bash
# Build and run the PS/2 receiver test.
#
# The scan-code map is a $readmemh pROM, so the test runs from artifacts/image/
# where make_ps2map.mjs wrote ps2map.hex.
set -euo pipefail

cd "$(dirname "$0")/.."

node scripts/make_ps2map.mjs

verilator --cc --exe --build -O2 -Wall --top-module ps2_rx_tb \
  -Mdir obj_ps2 \
  rtl/ps2_rx.sv rtl/sim/ps2_rx_tb.sv rtl/sim/ps2_rx_tb.cpp \
  -o ps2_rx_tb

ROOT="$(pwd)"
cd artifacts/image
"$ROOT/obj_ps2/ps2_rx_tb"
