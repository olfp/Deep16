#!/usr/bin/env bash
# Verilator regression for the flash boot loader (model preloaded with
# image.flash.hex). Runs the real PSRAM machine with USER_FLASH and the
# second-boot check, like the packed-BSRAM regression.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/make_image.mjs
verilator --cc --exe --build -O2 -Wno-fatal -DD16MINI -DPSRAM -DUSER_FLASH -DFLASH_PRELOAD \
  --top-module psram_boot_tb -Mdir obj_psram_flash \
  rtl/deep16_pkg.sv rtl/deep16_alu.sv rtl/deep16_regfile.sv rtl/deep16_cache.sv \
  rtl/deep16_divider.sv rtl/deep16_uart.sv rtl/deep16_core.sv rtl/deep16_top.sv \
  rtl/psram/psram_word_bridge.sv rtl/psram/psram_word_model.sv rtl/psram/deep16_psram_mem.sv \
  rtl/flash/flash608k_model.sv rtl/flash/flash608k_core.sv rtl/flash/flash608k_ctrl.sv rtl/flash/flash_boot.sv \
  rtl/sim/psram_boot_tb.sv rtl/sim/psram_boot_tb.cpp -o psram_boot_tb
ROOT="$(pwd)"
cd artifacts/image
SIM_MS="${SIM_MS:-8000}" "$ROOT/obj_psram_flash/psram_boot_tb"
