#!/usr/bin/env bash
# Build and run the SPI master test (MISO looped back to MOSI).
set -euo pipefail
cd "$(dirname "$0")/.."

verilator --cc --exe --build -O2 -Wall --top-module spi_tb \
  -Mdir obj_spi \
  rtl/deep16_spi.sv rtl/sim/spi_tb.sv rtl/sim/spi_tb.cpp \
  -o spi_tb

./obj_spi/spi_tb
