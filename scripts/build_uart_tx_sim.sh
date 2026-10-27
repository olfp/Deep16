#!/usr/bin/env bash
# Build and run the one-byte UART TX test.
set -euo pipefail
cd "$(dirname "$0")/.."

verilator --cc --exe --build -O2 -Wall -Wno-PINCONNECTEMPTY --top-module uart_tx_tb \
  -Mdir obj_uart_tx \
  rtl/deep16_uart.sv rtl/sim/uart_tx_tb.sv rtl/sim/uart_tx_tb.cpp \
  -o uart_tx_tb

./obj_uart_tx/uart_tx_tb
