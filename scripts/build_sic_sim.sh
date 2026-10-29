#!/usr/bin/env bash
# Build and run the interrupt-controller test.
set -euo pipefail
cd "$(dirname "$0")/.."

verilator --cc --exe --build -O2 -Wall --top-module sic_tb \
  -Mdir obj_sic \
  rtl/deep16_sic.sv rtl/sim/sic_tb.sv rtl/sim/sic_tb.cpp \
  -o sic_tb

./obj_sic/sic_tb
