#!/usr/bin/env bash
# Build the Deep16 RTL core into WebAssembly (Verilator + Emscripten).
#
# Two artifacts land in rtl/pkg/, which is committed like wasm/pkg/ so the IDE
# and the test suite run without a build step:
#   deep16_rtl_gen.js  - the Emscripten module factory (generated)
#   deep16_rtl_gen.wasm- the compiled model (generated)
# deep16_rtl.js is hand-written glue that turns the flat C API of
# rtl/sim/harness.cpp into the same shape the wasm-bindgen core exposes, so
# js/deep16_ui_core.js and the tests can switch cores by name only.
set -euo pipefail

cd "$(dirname "$0")/.."

VERILATOR_INC="$(verilator -V 2>/dev/null | awk -F= '/VERILATOR_ROOT/ {print $2}')/include"
if [ ! -d "$VERILATOR_INC" ]; then
  VERILATOR_INC=/usr/share/verilator/include
fi

RTL_SOURCES=(
  rtl/deep16_pkg.sv
  rtl/deep16_alu.sv
  rtl/deep16_regfile.sv
  rtl/deep16_core.sv
  rtl/deep16_top.sv
)

mkdir -p rtl/pkg rtl/obj_wasm

# 1) verilate to C++
verilator --cc -O3 --exe --top-module deep16_top \
  -Mdir rtl/obj_wasm \
  "${RTL_SOURCES[@]}" \
  rtl/sim/harness.cpp

# 2) compile the model + harness to WASM. Verilator emits one .cpp per split
#    source; without --build there is no __ALL.cpp aggregator, so glob them.
#    The DPI translation unit is skipped: nothing in the design uses DPI and its
#    svdpi.h clashes with the header Emscripten ships.
MODEL_SRCS=$(ls rtl/obj_wasm/Vdeep16_top*.cpp | grep -v '__Dpi.cpp')
if echo "$MODEL_SRCS" | grep -q '__ALL'; then
  echo "unexpected aggregator file; compile only Vdeep16_top__ALL.cpp" >&2
  exit 1
fi

em++ -O2 -std=c++17 -DVL_IGNORE_UNKNOWN_ARCH \
  rtl/sim/harness.cpp \
  $MODEL_SRCS \
  "$VERILATOR_INC/verilated.cpp" \
  "$VERILATOR_INC/verilated_threads.cpp" \
  -I rtl/obj_wasm -I "$VERILATOR_INC" -I "$VERILATOR_INC/vltstd" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=deep16RtlFactory \
  -sENVIRONMENT=web,worker,node \
  -sEXPORTED_FUNCTIONS='[_init,_reset,_step,_run_steps,_get_registers,_get_psw,_get_segments,_get_memory_slice,_get_memory_word,_set_registers,_set_psw,_set_segments,_load_program,_kbd_push,_kbd_clear,_get_recent_access,_get_last_event,_get_shadow_state,_get_cycle_count,_get_delay_state,_poke,_peek,_get_step_count,_get_debug_state,_set_debug_state,_malloc,_free]' \
  -sEXPORTED_RUNTIME_METHODS='[HEAPU16,HEAPU32,cwrap,ccall]' \
  -sINITIAL_MEMORY=32MB \
  -o rtl/pkg/deep16_rtl_gen.js

echo "built: rtl/pkg/deep16_rtl_gen.js rtl/pkg/deep16_rtl_gen.wasm"
echo "glue : rtl/pkg/deep16_rtl.js (committed, no build needed)"