#!/usr/bin/env bash
# Build and run the full config-flash boot-loader test. It boots the same
# D16D image twice: format 2 (chapter table) and format 1 (hardcoded windows).
set -euo pipefail
cd "$(dirname "$0")/.."

# D16D implies FPU; state it so the 0x5800 BIOS-copy check is intentional.
FPU=1 D16NANO=1 D16D=1 D16SEG=1 node scripts/make_image.mjs >/dev/null
cp artifacts/image/image.flash.hex artifacts/image/image.flash.format2.hex
# The legacy format-1 header is still accepted by the same loader.
FPU=1 D16NANO=1 D16D=1 D16SEG=1 node --input-type=module -e "
  import fs from 'node:fs';
  import { buildImage, installerFlash, flashHex } from './scripts/make_image.mjs';
  const img = { ...buildImage(), format: 1 };
  fs.writeFileSync('artifacts/image/image.flash.format1.hex', flashHex(installerFlash(img)));
"

verilator --cc --exe --build -O2 -Wall -Wno-fatal -DD16SEG --top-module flash_boot_tb \
  -Mdir obj_flash_boot \
  rtl/deep16_spi.sv rtl/flash/boot_spi_read.sv rtl/flash/flash_boot.sv \
  rtl/sim/flash_boot_tb.sv rtl/sim/flash_boot_tb.cpp \
  -o flash_boot_tb

ROOT="$(pwd)"
cd artifacts/image
for image in image.flash.format2.hex image.flash.format1.hex; do
  cp "$image" image.flash.hex
  echo "== $image =="
  "$ROOT/obj_flash_boot/flash_boot_tb"
done
