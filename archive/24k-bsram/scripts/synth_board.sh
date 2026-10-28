#!/usr/bin/env bash
# Open-source synthesis + place & route for the D16MINI board build, as far as it
# goes without the vendor tools (D16MINI.md §10).
#
# Needs the OSS CAD Suite on PATH (yosys with read_slang, nextpnr-himbaechel,
# gowin_pack):  https://github.com/YosysHQ/oss-cad-suite-build/releases
#   source <oss-cad-suite>/environment && npm run synth:board
#
# The boot image is regenerated first, so what is synthesised is what the
# bitstream would hold. Note that as the design stands this stops at place &
# route: the memory needs more BSRAM blocks than the chip has (§4.1).
set -euo pipefail

cd "$(dirname "$0")/.."

node scripts/make_image.mjs
mkdir -p build

# $readmemh resolves against the working directory, so synthesise from there.
cd artifacts/image
yosys -s ../../scripts/synth_board.ys

cd ../..
nextpnr-himbaechel \
  --device GW1NR-LV9QN88PC6/I5 --vopt family=GW1N-9 \
  --json build/board.json --write build/board_pnr.json \
  --vopt cst=rtl/deep16_board.cst \
  --freq 27 --report build/board.rpt

gowin_pack -d GW1NR-9 -o build/board.fs build/board_pnr.json
echo "built: build/board.fs"
