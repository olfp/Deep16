#!/usr/bin/env bash
# Build and run the system timer test.
set -euo pipefail
cd "$(dirname "$0")/.."

verilator --cc --exe --build -O2 -Wall --top-module timer_tb \
  -Mdir obj_timer \
  rtl/deep16_timer.sv rtl/sim/timer_tb.sv rtl/sim/timer_tb.cpp \
  -o timer_tb

./obj_timer/timer_tb
