#!/usr/bin/env bash
# Build and run the tile console's Verilator test.
#
# The tile font and palette are generated into artifacts/image by make_image,
# so the test runs there just like the text-console sim.
set -euo pipefail

cd "$(dirname "$0")/.."

node scripts/make_image.mjs

verilator --cc --exe --build -O2 --top-module dvi_tile_tb \
  -Mdir obj_dvi_tile \
  rtl/dvi/dvi_tile.sv rtl/sim/dvi_tile_tb.sv rtl/sim/dvi_tile_tb.cpp \
  -o dvi_tile_tb

ROOT="$(pwd)"
cd artifacts/image
"$ROOT/obj_dvi_tile/dvi_tile_tb"
