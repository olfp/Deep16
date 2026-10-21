#!/usr/bin/env bash
# Build and run the DVI text console's Verilator test.
#
# The Gowin PHY (rPLL, OSER10, ELVDS) cannot be simulated here, but the whole
# terminal path can: UART receive at 115200, the ANSI parser, the packed cell
# memory, the 8x15 font lookup, the pixel pipeline and the sync geometry. The
# test also cross-checks the TMDS encoder separately (see rtl/dvi/README.md).
#
# The font is read with $readmemh, so run from artifacts/image like the other
# board simulations.
set -euo pipefail

cd "$(dirname "$0")/.."

node scripts/make_image.mjs

verilator --cc --exe --build -O2 --top-module dvi_text_tb \
  -Mdir obj_dvi_text \
  rtl/dvi/dvi_text.sv rtl/sim/dvi_text_tb.sv rtl/sim/dvi_text_tb.cpp \
  -o dvi_text_tb

ROOT="$(pwd)"
cd artifacts/image
"$ROOT/obj_dvi_text/dvi_text_tb"
