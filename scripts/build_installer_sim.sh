#!/usr/bin/env bash
# Verilator test for the one-time installer: blank FLASH608K model, program the
# image.flash.hex ROM, check LED PASS and the header/image read-back.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/make_image.mjs
verilator --cc --exe --build -O2 -Wno-fatal --top-module flash_installer_tb \
  -Mdir obj_flash_install \
  rtl/flash/flash608k_model.sv rtl/flash/flash608k_core.sv rtl/flash/flash608k_ctrl.sv \
  rtl/flash/flash_installer.sv rtl/sim/flash_installer_tb.sv rtl/sim/flash_installer_tb.cpp \
  -o flash_installer_tb
ROOT="$(pwd)"
cd artifacts/image
"$ROOT/obj_flash_install/flash_installer_tb"
