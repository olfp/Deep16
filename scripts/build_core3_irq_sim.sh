#!/usr/bin/env bash
# Build and run the core3 hardware-IRQ entry test.
set -euo pipefail
cd "$(dirname "$0")/.."

verilator --cc --exe --build -O2 -Wall -Wno-fatal --top-module core3_irq_tb \
  -Mdir obj_core3_irq \
  rtl/deep16_pkg.sv rtl/deep16_alu.sv rtl/deep16_regfile.sv \
  rtl/deep16_core3.sv rtl/sim/core3_irq_tb.sv rtl/sim/core3_irq_tb.cpp \
  -o core3_irq_tb

./obj_core3_irq/core3_irq_tb
