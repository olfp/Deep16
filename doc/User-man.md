# DeepCode User Manual (Short Guide)

## Overview
DeepCode is an integrated assembler and simulator for the Deep16 architecture. It provides an editor, an assembler, a simulator (JS and WASM cores), and a memory/register view with lightweight debugging aids.

## Workflow: Edit → Assemble → Simulate
- Edit
  - Use the Editor tab to write or load `.a16` source files. The File menu supports New/Load/Save.
  - The status line and transcript panel report actions and messages.
- Assemble
  - Click `Assemble` to compile the source. On success, memory and symbols are updated; on errors, open the Errors tab.
  - The transcript shows assembly progress and results. Code/data segmentation is reflected in the memory view.
- Simulate
  - Use `Run` to start/stop continuous execution. Use `Step` to execute exactly one instruction. Use `Reset` to reset the machine state.
  - The run-state indicator between Run and Step shows `Run` (green) or `Halt` (red).
  - JS and WASM cores are both supported; WASM can be toggled in the header if available.

## Debugging with Breakpoints
- Add/Remove
  - Click a code line in the memory display to toggle a breakpoint at that physical address. A `B` appears on the far-left of the code line.
  - The memory header shows active breakpoints as `BP@ 0x00100 ×, 0x00120 ×, …`. Click the `×` next to an entry to delete that breakpoint.
- Run/Step behavior
  - Run halts before executing an instruction at a breakpoint and logs a message. Pressing Run again steps once off the breakpoint and continues.
  - Step executes one instruction and does not stop at breakpoints; use Run to halt at breakpoints.

## Memory Panel
- Header and Controls
  - Header displays `Memory Display (BP@ …)` with the current breakpoint list.
  - Address controls: `Start` (physical address) and `Symbol` selector to jump; segmented navigation `CS::PC` with `Go to` to compute physical address and center the view.
- Display
  - Code lines: address, word bytes (hex), disassembly, and optional source comment; PC is highlighted when visible.
  - Data lines: grouped by 8 words per line; each word shows hex value; PC marker appears if PC lands on a data word.
  - A `B` at the far-left indicates a breakpoint on that code line.
- Navigation
  - The view typically renders 64 addresses starting at `Start`. Large jumps auto-center the PC to keep control flow visible. Manual address changes are respected.

## Recent Memory Access Panel
- Purpose
  - Shows a compact window of recent memory activity: 4 lines × 8 words with addresses and values.
- Highlighting
  - For LD/ST with non-zero offsets, both the base and current addresses are highlighted.
  - For zero-offset accesses, only the current address is highlighted.
- Info Line
  - Displays the last access type (`Load`/`Store`), destination address, and any base+offset context.

## Tips
- Use the transcript for a chronological log of assemble/run/stop and memory events.
- The registers/PSW panel updates in real time; segment registers reflect current execution context.
- Compact View reduces register panel visual footprint when focusing on memory and execution.
