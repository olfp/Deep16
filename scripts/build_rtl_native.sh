#!/usr/bin/env bash
# Build the Deep16 RTL core natively with Verilator.
#
# Produces obj_dir/deep16_rtl - a small CLI that runs a program on the RTL core
# and prints the final state as JSON (see rtl/sim/main_native.cpp). Used for
# differential debugging against the JS core; the WASM package (npm run
# build:rtl:wasm) is what the tests and the IDE load.
set -euo pipefail

cd "$(dirname "$0")/.."

RTL_SOURCES=(
  rtl/deep16_pkg.sv
  rtl/deep16_alu.sv
  rtl/deep16_regfile.sv
  rtl/deep16_core.sv
  rtl/deep16_top.sv
)

verilator --cc --exe --build -O2 -Wall \
  --top-module deep16_top \
  -Mdir obj_dir \
  "${RTL_SOURCES[@]}" \
  rtl/sim/harness.cpp rtl/sim/main_native.cpp \
  -o deep16_rtl

echo "built: obj_dir/deep16_rtl"