#!/usr/bin/env bash
# Build and run the full config-flash boot-loader test.
set -euo pipefail
cd "$(dirname "$0")/.."

D16NANO=1 D16D=1 D16SEG=1 node scripts/make_image.mjs >/dev/null

verilator --cc --exe --build -O2 -Wall -Wno-fatal -DD16SEG --top-module flash_boot_tb \
  -Mdir obj_flash_boot \
  rtl/deep16_spi.sv rtl/flash/boot_spi_read.sv rtl/flash/flash_boot.sv \
  rtl/sim/flash_boot_tb.sv rtl/sim/flash_boot_tb.cpp \
  -o flash_boot_tb

ROOT="$(pwd)"
cd artifacts/image
"$ROOT/obj_flash_boot/flash_boot_tb"
