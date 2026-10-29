#!/usr/bin/env bash
# Build and run the config-flash boot reader test.
set -euo pipefail
cd "$(dirname "$0")/.."

verilator --cc --exe --build -O2 -Wall -Wno-fatal --top-module boot_spi_tb \
  -Mdir obj_boot_spi \
  rtl/deep16_spi.sv rtl/flash/boot_spi_read.sv \
  rtl/sim/boot_spi_tb.sv rtl/sim/boot_spi_tb.cpp \
  -o boot_spi_tb

./obj_boot_spi/boot_spi_tb
