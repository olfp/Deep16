#!/usr/bin/env bash
# Build the core3 Pole road-renderer benchmark.
#
# The binary takes a $readmemh program image and prints its cycle and
# instruction counts; scripts/bench_pole.mjs drives it.
set -euo pipefail
cd "$(dirname "$0")/.."

verilator --cc --exe --build -O2 -Wall -Wno-fatal --top-module core3_pole_bench_tb \
  -Mdir obj_core3_pole_bench \
  rtl/deep16_pkg.sv rtl/deep16_alu.sv rtl/deep16_regfile.sv \
  rtl/deep16_core3.sv rtl/sim/core3_pole_bench_tb.sv rtl/sim/core3_pole_bench_tb.cpp \
  -o core3_pole_bench
