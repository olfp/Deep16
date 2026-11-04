---
type: "Reference"
title: "DeepWeb IDE"
openwiki_generated: true
sources:
  - id: openwiki-source-f8d10828394c4129061d5b0e
    resource: repo://index.html
  - id: openwiki-source-16651e85b7a394cda65dfc7d
    resource: repo://js/deep16_d16d_image.js
  - id: openwiki-source-a4cdf03124e6a4fc0fb766f9
    resource: repo://js/deep16_terminal.js
  - id: openwiki-source-0cc31ca306d30bed999278fc
    resource: repo://js/deep16_ui_core.js
  - id: openwiki-source-2ba140a4fd66f00a30fd141c
    resource: repo://js/deep16_ui_memory.js
  - id: openwiki-source-ef0b83c5a121623e40b01d88
    resource: repo://js/deep16_ui_registers.js
  - id: openwiki-source-8eb5da3ff50c8a997cf24572
    resource: repo://js/deep16_ui_screen.js
  - id: openwiki-source-d9cd8fddbb3a3a0b0c1da1cc
    resource: repo://js/deep16_worker.js
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-bf2a0339ada6a56de8b7a79c
    resource: repo://rtl/deep16_board.sv
  - id: openwiki-source-995b05cde9e7dd8086199c38
    resource: repo://scripts/render_tile.mjs
generated: { by: "opencode", at: "2026-11-04T09:31:05.972Z" }
verified:
  - by: openwiki/0.7.3
    at: 2026-11-04T15:30:01.509Z
---


# DeepWeb IDE

DeepCode is a single static page. `index.html` plus plain `<script>` files make
up the IDE, and the two compiled cores arrive as ES modules from committed
packages. There is no bundler, no transpiler and no server-side code.

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

Serving over HTTP is required: the WASM and RTL modules are fetched, so a
`file://` open leaves the IDE on the JavaScript core. This is a deliberate
constraint, not an accident — `wasm/pkg/` and `rtl/pkg/` are committed so that
cloning the repository is enough to run the IDE.

## Bootstrap

The page loads its scripts in dependency order:

| Order | Script | Purpose |
|---|---|---|
| 1 | `css/main.css` | Layout and theme |
| 2 | `js/deep16_assembler.js`, `deep16_disassembler.js`, `deep16_optimizer.js` | Toolchain |
| 3 | `js/deep16_simulator.js` | JS reference core |
| 4 | `js/deep16_flash_assets.js`, `deep16_gfx_loader.js`, `deep16_tile_engine.js`, `deep16_d16d_image.js` | FiT graphics model, asset blob and D16D image builder |
| 5 | `js/deep16_ui_registers.js`, `deep16_ui_memory.js`, `deep16_terminal.js`, `deep16_ui_screen.js` | Panels |
| 6 | inline `type="module"` | Import the WASM and RTL packages |
| 7 | `js/deep16_ui_core.js` | The `DeepWebUI` controller |

The module block imports `./wasm/pkg/deep16_wasm.js` and `./rtl/pkg/deep16_rtl.js`
with cache-busting query strings, initialises each, publishes
`window.Deep16Wasm` / `window.Deep16Rtl` and their `…Ready` promises, and
dispatches `deep16-wasm-ready` / `deep16-rtl-ready`. A failed import only logs a
warning; the selector then reports that core as unavailable.

`deep16_ui_core.js` ends with a `DOMContentLoaded` handler that constructs
`DeepWebUI`, calls `reset()` and then `run()`. The editor ships with a small
sample program in the textarea, so the page is live on first paint.

## The controller

`DeepWebUI` owns the toolchain and the machine:

- one `Deep16Assembler`, `Deep16Disassembler` and `Deep16Simulator`;
- `Deep16MemoryUI`, `Deep16RegisterUI` and `Deep16ScreenUI`, each holding a
  back-reference to the controller;
- `simulator.setUI(this)` so the JS core can push screen writes;
- an autoloaded boot ROM, with `CS` set to `0xFFFF` for the initial state;
- the FiT tile engine (created on demand in Tiles mode) and the cached D16D
  showcase sources (showcase, Flappy, Pac-Man map and game);
- the example manifest, file handle, console mode, tile clock and transcript.

The transcript is capped at 50 entries. It is the IDE's only log: warnings,
core switches, breakpoint hits and optimizer stats all land there.

## Three cores, one source of truth

The settings cog exposes a core selector with `js`, `wasm` and `rtl`. The stored
field is `coreName`; `useWasm` survives only as a derived flag, because display
code has many "is a compiled core active" branches.

- The selection is persisted as `deep16_core` (and the legacy boolean
  `deep16_use_wasm` is still read once so an upgrade does not reset the choice).
- `coreAvailable()` checks that the module was actually imported.
- Switching mirrors state instead of resetting: `syncStateIntoCore()` calls
  `init(memory.length)`, `load_program(0, memory)`, `set_segments`, `set_psw`,
  `set_registers`, in that order. PSW must precede registers because
  `set_registers` resolves element 15 through the current `PSW.S` bit.
- Switching cancels a running interval first. If the mirror fails, the IDE
  reports it and stays on the previous core.

The JS core remains authoritative. Every state copy travels JS → compiled core,
never the reverse; the compiled core's observed stores are copied back into the
JS memory as they happen (see below).

## Run, step and reset

`run()` toggles. It calls `ensureTerminalCore()` first (terminal mode needs a
core with `uart_tx_take`), and in terminal mode it will assemble the editor text
if it differs from the last assembled source — otherwise Run would execute a
stale image.

Both run loops use a **10 ms `setInterval`**. The step budget is
`instructionsPerTick()`: 200 instructions in screen/terminal mode and 6,000 in
Tiles mode, because the game's `wait_frame` loop needs a few thousand steps per
frame. There is no `requestAnimationFrame` loop and no worker. A separate 60 Hz
tile clock owns `0xF0066`, ticks the tile engine and repaints the canvas, so the
run loop never drives the display.

The JS loop (`jsRun`):

1. stop when `simulator.running` is false;
2. drain the UART once per tick (`pumpConsole`);
3. before each instruction, compute physical `CS:PC` and test it against the
   breakpoint set;
4. execute up to 200 steps, stopping early on halt or a breakpoint;
5. if the PC jumped more than 16 words out of the 64-word memory window, recentre
   the window (behind the trace gate);
6. on exit, update all displays and the Run button.

The compiled loop (`wasmRun`) has the same cadence and breakpoint rule, but each
instruction is followed by `get_recent_access()`: if the access was a store, the
word is read back with `get_memory_word`, written into `simulator.memory`, routed
to the screen panel when it falls in screen memory, and folded into a dirty
range. That is what keeps the panels, the screen and any later JS run in sync
with a core that executes outside the JS object model.

`step()` executes exactly one instruction on whichever core is active, resolves
the shadow PC when `PSW.S` is set, recentres the memory window near the new PC,
and logs a `before -> after` transcript entry. It forces `simulator.running` on
for the duration so a single step works after a halt.

`reset()` clears the run interval, cancels any in-flight file upload (which
would otherwise keep typing into a machine that no longer expects input), resets
both the active core and the JS simulator, restores the shipped memory image,
re-reads the echo flag, and recentres on the reset PC.

## Debugger and panels

**Breakpoints.** The memory panel starts with one breakpoint at `0x00100` (the
boot entry). Clicking a row toggles a breakpoint; the panel draws a `B` in its
own column and lists them in a header. The run loops test the physical address
*before* executing, so a breakpoint stops on the instruction, and resuming steps
over it once instead of re-triggering.

**Registers.** `updateRegisterDisplay` prints `R0`–`R15` with aliases
(`FP / R12`, `SP / R13`, `LR / R14`, `PC / R15`) as four-digit hex.
`updatePSWDisplay` maps the status bits to the checkbox row: `DE` bit 15, `DS`
bit 10, `S` bit 5, `I` bit 4, `C` bit 3, `V` bit 2, `Z` bit 1, `N` bit 0. A
separate section shows the segment registers and the shadow bank.

**Memory.** The view is a 64-word window with a settable start address, symbol
and segment jump boxes, and a recent-access display. Each word is shown through
the disassembler, and conditional jumps print their resolved target.
`renderMemoryDisplay` highlights the last data access and the PC. The window
re-centres on large jumps and while following a running machine — except while a
file is typing itself in, when memory changes too fast to read.

**Screen.** `Deep16ScreenUI` draws the 80 × 24 character buffer at `0xF1000`
(1,920 words, ending at `0xF177F`). The high byte of a screen word carries
4-bit foreground and background in ANSI order; attribute 0 means "default" so
plain text needs no colour knowledge. There is no cursor attribute: the kernel
marks the cursor by swapping the two nibbles (reverse video), mirrored in the
IDE as `CURSOR_ATTR = 0x7000`. The panel repaints only cells whose drawn value
changed, which is what keeps 1,920 spans from stuttering the loop.

**Terminal.** `SerialTerminal` is a minimal VT: printable ASCII with autowrap,
CR, LF with scroll, BS, TAB, CSI `J` (clear and home) and CSI `H`/`f` (home
only, parameters ignored); every other escape and CSI sequence is consumed and
dropped. It renders into the same 80 × 24 grid when the console mode is
terminal.

**Trace.** The Trace button is a single gate for every panel update: when it is
off, `updateAllDisplays` returns after draining the UART, so the machine keeps
running and the terminal keeps filling while the registers, memory and screen
stop redrawing.

## Console modes

One global switch, persisted as `deep16_console`, drives three things at once:

| Mode | Assembler defines | Screen tab | Input route |
|---|---|---|---|
| `screen` (default) | none | 0xF1000 character buffer | keyboard FIFO |
| `terminal` | `{ CONSOLE_UART: 1 }` | UART byte stream | UART receive FIFO |
| `tiles` | `{ CONSOLE_UART, D16NANO, D16SEG, D16D? }` | 640×360 FiT canvas | keyboard/UART via the tile demo |

Because the build follows the mode, toggling it rebuilds whatever is in the
editor so the loaded image matches the display. Terminal and Tiles modes also
check that the active core exposes the UART hooks; Tiles mode additionally
forces the JS core because the compiled cores have no display-status word yet.

## Tiles mode and the D16D image

Tiles mode is the D16nano FiT path. `ensureTileEngine()` creates a
`Deep16TileEngine` and attaches it to the simulator, so every video-window store
is mirrored into the engine in order. `loadTileAssets()` writes the generated
graphics blob (`js/deep16_flash_assets.js`) into the engine and the simulated
config flash. The 60 Hz `tickTileFrame()` sets `simulator.tileStatus`, ticks the
engine and asks the Screen panel to repaint the canvas.

When the selected example carries `build: "d16d"`, `Assemble` calls
`buildD16DImage(kernelSource)`: the browser `Deep16D16DImage.build()` assembles
the editor kernel together with the cached `showcase.asm`, `flappy_game.asm`,
`pacman_map.asm` and `pacman_game.asm`, fills the 24K window and returns the
kernel symbols. The sources are fetched once when the example is loaded
(`asm/showcase/...`, `cache: 'no-store'`) and reused.

The builder mirrors `scripts/make_image.mjs`. Its `bakePacman` flag defaults to
false because the current D16D image leaves Pac-Man in config flash; passing it
bakes the block at `0x4330` for a preview. The headless renderer uses that for
its Pac-Man scene. In the IDE the menu's **P** entry still targets `0x4330`, so
the in-browser menu cannot launch the game until the flash-loader hookup lands;
the tile engine and graph assets still render the menu and Flappy normally.

## Editor, files and examples

The editor is a `<textarea>` with a `<pre>` highlight overlay; tab width is
persisted as `deep16.tabSize` and re-indents the selection on Tab.

File operations use the File System Access API where available
(`showOpenFilePicker`, `showSaveFilePicker`) and fall back to a hidden file input
and a download link. The current handle is kept so Save writes in place; Save As
replaces the handle and filename.

A file whose name ends in `.fth` or `.forth` is not opened in the editor at all:
it is Forth source, so it is queued as keystrokes for the running kernel and the
transcript says so. That check is in code rather than in the dialog's `accept`
list because iOS Safari does not enforce the list.

Examples are fetched from `asm/examples.json` at startup, grouped into
`<optgroup>`s by category, and loaded from `asm/<filename>` with
`cache: 'no-store'` — the example files carry no version query, so a stale
kernel could otherwise be served from the HTTP cache. Loading an example only
fills the editor and switches to the Editor tab; it does not assemble. The
`D16D Showcase (tiles)` entry also fetches the showcase, Flappy and Pac-Man
sources for the tile builder.

The Docs menu fetches `doc/Deep16-Arch.md`, `FORTH.md` or `doc/User-man.md` and
renders it in an overlay with a small built-in Markdown renderer. Escape or a
click outside closes it.

## The worker that is not used

`js/deep16_worker.js` is a complete Web Worker: it imports the simulator,
handles `INIT`, `LOAD_PROGRAM`, `RUN`, `STEP`, `RESET` and `STOP`, and posts
state back. It is **not wired up**. No `new Worker(...)` exists anywhere in the
tree, `workerRun()` is a dead method that posts to an undefined `this.worker`,
and no script tag loads the file. Execution is entirely main-thread; the 10 ms
tick with 200 or 6,000 steps is the only scheduling mechanism. Treat the worker as
scaffolding for a future off-thread run, not as part of the current event flow.

## Persisted settings

| Key | Meaning |
|---|---|
| `deep16_core` | `js`, `wasm` or `rtl` |
| `deep16_use_wasm` | Legacy boolean, read once when `deep16_core` is absent |
| `deep16_console` | `screen`, `terminal` or `tiles` |
| `deep16.tabSize` | Editor tab width |

All reads and writes are wrapped in `try/catch`, so private browsing or a
disabled storage backend degrades to defaults rather than breaking the page.

## Mobile and input

A hidden, focusable input (`#terminal-kbd-hook`) exists because iOS only raises
the soft keyboard for a real input focused inside a tap. Tapping the screen
focuses it; key events then reach `handleTerminalKey`, which translates them to
the simulator's key codes. Inputs and textareas elsewhere clear the
terminal-active state, so typing in the editor does not also type into the
machine. `setupMobileLayout()` runs on load and resize to rearrange the panels.

## Related pages

- [Assembler, Disassembler and Optimizer](assembler-and-optimizer.md)
- [JavaScript Reference Core](../cores/js-core.md)
- [WebAssembly Core](../cores/wasm-core.md)
- [Core Parity and Verification](../architecture/core-parity.md)
