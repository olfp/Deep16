#!/usr/bin/env bash
# Build and run the I2S serialiser test (FIFO, framing, loop, underrun).
set -euo pipefail
cd "$(dirname "$0")/.."

verilator --cc --exe --build -O2 -Wall --top-module i2s_tb \
  -Mdir obj_i2s \
  rtl/deep16_i2s.sv rtl/sim/i2s_tb.sv rtl/sim/i2s_tb.cpp \
  -o i2s_tb

./obj_i2s/i2s_tb
