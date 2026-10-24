# Deep16 memory map

Status: **reference for the current tree**, measured 2026-10-24. Addresses of
kernel symbols drift whenever the kernel grows; the fixed hardware/BIOS/stack
addresses do not. Re-check `dict_free` and the boot-script address after a
kernel change (the assembler symbol dump is the source of truth).

This document covers:

* the CPU word-address space and segment model,
* the three builds (screen/IDE, D16MINI UART, D16nano tile),
* the D16nano/D16D fixed layout,
* MMIO (UART, keyboard, tile engine, cycle counter),
* PSRAM and the two flash devices.

All addresses are **16-bit word addresses**, not bytes, unless a section says
otherwise.

---

## 1. Address model

| Item | Value |
|---|---|
| Cell size | 16 bit |
| Physical address | 20 bit, `0x00000`–`0xFFFFF` |
| CPU-visible memory | 1,048,576 words = 2 MiB |
| Segment registers | 16-bit CS, DS, SS, ES (normal and shadow bank) |
| Physical address | `(segment << 4) + offset`, 20-bit result |
| Reset | `CS = 0xFFFF`, `PC = 0` → physical `0xFFFF0` (boot ROM) |
| Empty/unbacked read | `0xFFFF` (the halt word) |
| Unbacked write | dropped |

`0xFxxxx` addresses are non-cacheable MMIO. The boot ROM is a 16-word LUT at
`0xFFFF0`–`0xFFFFF`; the reset vector is its first word. The boot ROM zeroes
DS/SS, puts `0x0100` in R1, writes the entry at physical 0..2 and jumps to
`0000:0100`.

The **SWI vector** is physical `0x0002`; the kernel installs its handler at run
time. `0x0000`–`0x00FF` is the zero page / boot staging area.

---

## 2. Build profiles

| | Screen / IDE | D16MINI (UART) | D16nano (tile) |
|---|---|---|---|
| CPU image | 1 MiB flat array | 24K-word image, PSRAM-backed | 24K-word user-flash image, PSRAM-backed |
| BIOS entry | `0xF8000` | `0x5600` | `0x4A00` |
| Dictionary ceiling | `0x4000` | `0x5600` initially; PSRAM raises it to `0xFFF0` | `0x4A00` initially; PSRAM raises it to `0xFFF0` |
| Return stack top | `0x6F00` (grows up) | `0x5800` (grows up) | `0x5800` (grows up) |
| Data stack top | `0x7FF0` (grows down) | `0x5FF0` (grows down) | `0x5FF0` (grows down) |
| Display | `0xF1000` cell/attribute RAM | DVI text mirror, own cell RAM | `0xF1000` tilemap + tile engine |
| Console | UART `0xF0040` | UART `0xF0040` | UART `0xF0040` |
| Boot script | none | `demo.fth` baked in image | `demo.fth` baked in image |
| D16D demo | none | none | `0x4E00` |

The D16MINI and D16nano images both probe word **`0x6000`**. When it reads back,
the kernel moves `HERE` to `0x6000` and raises the dictionary ceiling to
`0xFFF0` (below the boot ROM), giving roughly 39,000 free words instead of the
few thousand in the 24K window.

---

## 3. Common map

| Range | Contents |
|---|---|
| `0x00000`–`0x00002` | boot entry staging / SWI vector (runtime; vector at 2) |
| `0x00000`–`0x000FF` | zero page, interrupt vector area |
| `0x00100` | `forth_start`, conventional program/kernel entry |
| `0x0F0040`–`0x0F004F` | UART console |
| `0x0F0060`–`0x0F0064` | keyboard FIFO / echo cell (build-specific) |
| `0x0F0068`–`0x0F006B` | D16nano 32-bit CPU cycle counter (read-only) |
| `0x0F1000` | display window (screen RAM or tilemap, build-specific) |
| `0x0F2000`–`0x0F2006` | tile control registers (tile build only) |
| `0x0F3000`–`0x0F3BFF` | tile bank (tile build only) |
| `0x0F4000`–`0x0F47FF` | sprite bank (tile build only) |
| `0x0F5000`–`0x0F50FF` | OAM / palette window (tile build only) |
| `0x0F8000` | BIOS entry in the 1 MiB screen build |
| `0x0FFFF0`–`0x0FFFFF` | 16-word boot ROM |

Addresses in the `0x0Fxxxx` range that are not decoded by the selected build
read `0xFFFF`; stores are dropped. The D16MINI UART build has no framebuffer
(`0xF1000` is not backed); the DVI text mirror keeps its cells inside the DVI
block.

---

## 4. D16nano tile build (current board)

The D16nano uses a 24,576-word flat image (`0x0000`–`0x5FFF`) in the on-die
user flash, copied to PSRAM at boot. The dictionary then continues at `0x6000`.

| Range | Contents |
|---|---|
| `0x00000`–`0x000FF` | zero page / SWI vector staging |
| `0x00100`–`0x004FF` | kernel block 1 (`forth_start`, built-ins, boot entry) |
| `0x00500`–`0x01FFF` | kernel block 2 (primitives, interpreter, compiler) |
| `0x02000`–`0x02FFF` | threading engine `next` and built-in word code |
| `0x03000`–`0x049F8` | kernel data, boot script, built-in headers, `rp0_base` |
| `0x049F9`–`0x049FF` | static `dict_free` … BIOS (7 words) |
| `0x04A00`–`0x04D2F` | BIOS code (segment `0x04A0`) |
| `0x04D30`–`0x04DFF` | gap |
| `0x04E00`–`0x04ED4` | D16D demo block (header + code, 213 words) |
| `0x04ED5`–`0x04FFF` | gap |
| `0x05000`–`0x052FF` | ILL trap handler (DIV/DIV32 emulation) |
| `0x05300`–`0x053FF` | `divtest` word code + string (`divtest_ok_str` at `0x532E`) |
| `0x05400`–`0x057FF` | reserved gap |
| `0x05800`–`0x05FEF` | Forth stacks: return stack from `0x5800` up, data stack from `0x5FF0` down |
| `0x05FF0`–`0x05FFF` | stack top cells / slack |
| `0x06000`–`0x0FFEF` | PSRAM dictionary, grows up from `0x6000`; Forth segment-0 ceiling `0xFFF0` |
| `0x10000`–`0x0FFFFF` | other 20-bit segments, unused by Forth; boot ROM at `0xFFFF0`–`0xFFFFF` |

### 4.1 Selected D16nano symbols (measured)

| Symbol | Address | Meaning |
|---|---|---|
| `forth_start` | `0x0100` | kernel entry |
| `sp0_base` | `0x3000` | data-stack base cell |
| `sp_top` | `0x3001` | data-stack top cell (`0x5FF0`) |
| `tib_kbd` | `0x3023` | 128-word keyboard line buffer |
| `ok_msg` | `0x30DD` | `" ok"` string |
| `h_divtest` | `0x37CC` | `divtest` dictionary header |
| `line_out` | `0x37E3` | output-produced flag |
| `ill_pc_save` | `0x37E4` | interrupted PC for the ILL handler |
| `active_handler` | `0x37F0` | `catch` handler cell |
| `state_var` | `0x313C` | compiler state |
| `base_var` | `0x3309` | numeric base |
| `dp_var` | `0x37E5` | dictionary pointer |
| `boot_script` | `0x3BDE` | baked `demo.fth` source |
| `boot_ptr` | `0x300F` | next boot-script line |
| `rp0_base` | `0x49F8` | return-stack base cell (`0x5800`) |
| `dict_free` | `0x49F9` | first statically free word |
| `bios_entry` | `0x4A00` | BIOS entry / dispatch |
| `ill_handler` | `0x5000` | ILL trap handler |
| `word_divtest` | `0x5300` | `divtest` code |
| `divtest_ok_str` | `0x532E` | `divtest ok` string |

The D16D demo at `0x4E00` has a four-word header (`0x0D16`, format 1, entry
offset 4, reserved); the BIOS function 6 (`gfx`) checks it, parks the Forth
R5/R6, jumps to `CS:0x04A0` entry `0x404` (`0x4E04`), and on return clears the
tilemap/scroll/OAM/cursor.

### 4.2 D16nano stack cells

* `sp0_base` (`0x3000`) is the data-stack empty/base cell.
* `sp_top` (`0x3001`) holds `0x5FF0`; `SP` starts there and grows down.
* `rp0_base` (`0x49F8`) holds `0x5800`; the return stack grows up from there.
* The stacks share the `0x5800`–`0x5FFF` window; a deep mixed recursion can
  collide, as on the other builds.

### 4.3 D16nano dictionary

* Static image ends at `dict_free = 0x49F9`; only 7 words remain before the BIOS.
* On PSRAM the boot probe moves `HERE` to `0x6000`; the runtime dictionary and
  the boot-script definitions (`free`, `mem`, `demo`, `divtest` header, etc.)
  live there.
* The ceiling is `0xFFF0`; `free` reports about 39,212 words after the baked
  script definitions (the exact number depends on the script/word set).
* The D16D demo at `0x4E00` is **not** in the dictionary; it is a fixed BIOS-gap
  block in the image/PSRAM.

---

## 5. D16MINI UART build

24,576-word image (`0x0000`–`0x5FFF`), PSRAM-backed; same boot-script/PSRAM
dictionary behaviour as D16nano, without the tile engine or D16D demo.

| Range | Contents |
|---|---|
| `0x00000`–`0x000FF` | zero page / SWI vector |
| `0x00100`–`0x049D5` | kernel image + boot script + built-in headers (`dict_free = 0x49D6`) |
| `0x049D6`–`0x055FF` | dictionary / boot-script growth before BIOS |
| `0x05600`–`0x057FF` | BIOS (segment `0x0560`) |
| `0x05800`–`0x05FEF` | stacks: return `0x5800` up, data `0x5FF0` down |
| `0x06000`–`0x0FFEF` | PSRAM dictionary after the PSRAM probe; ceiling `0xFFF0` |
| `0x10000`–`0x0FFFFF` | other 20-bit segments, unused by Forth; boot ROM at `0xFFFF0` |
| `0x0F0040`–`0x0F0046` | UART |
| `0x0F1000` | **not used by the console kernel**; DVI text owns its own cell RAM |
| `0x0FFFF0`–`0x0FFFFF` | boot ROM |

Selected symbols: `dict_free 0x49D6`, `rp0_base 0x49D5`, `bios_entry 0x5600`,
`boot_script 0x3BBB`, `boot_ptr 0x3004`, `tib_kbd 0x3018`, `ok_msg 0x30D2`,
`active_handler 0x37D1`.

---

## 6. Screen / IDE build (1 MiB)

| Range | Contents |
|---|---|
| `0x00000`–`0x000FF` | zero page / SWI vector |
| `0x00100`–`0x03BB5` | kernel image + built-in headers (`dict_free = 0x3BB6`) |
| `0x03BB6`–`0x03FFF` | dictionary (ceiling `0x4000`) |
| `0x04000`–`0x06EFF` | free RAM |
| `0x06F00`–`0x07FF0` | stacks: return `0x6F00` up, data `0x7FF0` down |
| `0x0F0040`–`0x0F0046` | UART (core port) |
| `0x0F0060`/`0x0F0062` | keyboard FIFO |
| `0x0F0064` | echo flag (ordinary RAM in the 1 MiB build) |
| `0x0F1000`–`0x0F17CF` | 80×24 screen: 2,000 words, `{attribute, character}` |
| `0x0F8000` | BIOS entry (segment `0xF800`) |
| `0x0FFFF0`–`0x0FFFFF` | boot ROM |

Screen cell format: low byte `ATTR_MASK` character, high byte attribute
(`CURSOR_ATTR = 0x7000`); `SCR`/R8 holds `0x1000`, with `ES = 0xF000`, so the
cell array is addressed at `0xF1000`.

The screen build has no baked boot script (`CONSOLE_UART` off) and no PSRAM
dictionary move. Selected symbols: `dict_free 0x3BB6`, `rp0_base 0x3BB5`,
`bios_entry 0xF8000`, `tib_kbd 0x3012`, `ok_msg 0x30CC`,
`active_handler 0x37CB`.

---

## 7. MMIO

### 7.1 UART (`0xF0040`–`0xF004F`)

| Address | Name | Access | Meaning |
|---|---|---|---|
| `0xF0040` | `UART_STAT` | R | b0 RX ready, b1 TX ready, b2 RX overrun, b3 TX idle |
| `0xF0042` | `UART_DATA` | R/W | read pops RX; write pushes TX |
| `0xF0044` | `UART_DIV` | R/W | baud divisor; 115200 8N1 (value is build-clock dependent; 234 was the 27 MHz D16LIGHT value) |
| `0xF0046` | `UART_CTRL` | W | b0 reset RX FIFO, b1 reset TX FIFO |
| `0xF0048`–`0xF004F` | — | — | reserved |

The UART is 115200 8N1 on the board. `ES = 0xF000`, so the BIOS addresses these
as `0x0040`, `0x0042`, `0x0046`. The boot ROM/BIOS and the JS/WASM cores decode
the same addresses.

### 7.2 Keyboard and echo

| Address | Name | Access | Meaning |
|---|---|---|---|
| `0xF0060` | `KBD_STATUS` | R | b0 data available |
| `0xF0062` | `KBD_DATA` | R | pop a key |
| `0xF0064` | `ECHO_FLAG` | R/W | screen/keyboard echo |

The keyboard FIFO is used by the simulation and the screen/IDE front end. On the
UART-only boards the UART is the input; the keyboard ports are not the console
path. `0xF0064` is ordinary RAM in the 1 MiB screen build but **not backed** on
the 24K UART boards: reads return `0xFFFF`, writes are dropped. The D16nano
kernel keeps its console/quiet state in kernel cells (`boot_quiet`, `line_out`).

### 7.3 D16nano cycle counter

| Address | Meaning |
|---|---|
| `0xF0068` | low 16 bits of the 32-bit CPU cycle counter (read-only) |
| `0xF006A` | high 16 bits (read-only) |
| `0xF006C`–`0xF006F` | reserved |

This is the benchmark time base; it is not a writable register.

### 7.4 Tile engine (`D16nano`/`DVI_TILE`)

Each memory has its own 4K-word page; the CPU window is write-through to the
tile engine and the PSRAM/Forth mirror at the same address.

| Address | Window | Contents |
|---|---|---|
| `0xF1000`–`0xF1853` | tilemap | 82×26 16-bit tile addresses; visible 80×24 plus one-tile margin |
| `0xF2000` | control 0 | `{row[4:0], col[6:0], enable}` cursor |
| `0xF2002` | control 1 | circular row offset (0..25) |
| `0xF2004` | control 2 | smooth `scroll_x` (0..15) |
| `0xF2006` | control 3 | smooth `scroll_y` (0..30) |
| `0xF3000`–`0xF3BFF` | tile bank | 96 tiles × 32 words; 30 words of 8×15 4bpp, word 30 palette pointer, word 31 flags |
| `0xF4000`–`0xF47FF` | sprite bank | 128 8×8 4bpp patterns × 16 words |
| `0xF5000`–`0xF500F` | OAM | 8 sprites × 2 words: `w0={behind,vflip,hflip,group[2:0],x[9:0]}`, `w1={enable,y[9:0]}` |
| `0xF5080`–`0xF508F` | palette | 16 × RGB332 entries |
| rest of `0xF5000`–`0xF50FF` | — | reserved |

Tile address convention: `(character - 0x20) * 32`. A 32×32 sprite is 16 8×8
tiles; `tile = group*16 + (row/8)*4 + column`. Sprite palette index 0 is
transparent; OAM bit 15 puts the sprite behind background index 0; sprite 0 wins
priority.

The **DVI tile build** uses the tilemap at `0xF1000`. The **screen build** uses
the same address for its cell/attribute array; the two never coexist. The
**D16MINI UART** build does not back `0xF1000`.

---

## 8. PSRAM and storage

### 8.1 CPU-visible PSRAM

| Item | Value |
|---|---|
| Device | HyperRAM, 64 Mbit package, only die 0 used |
| Physical die | 4 MB = 2 M words |
| CPU-visible window | `0x00000`–`0xFFFFF`, 1 M words = 2 MB |
| Boot image | `0x00000`–`0x05FFF`, 24,576 words |
| D16D demo | `0x04E00`–`0x04ED4` (inside the image) |
| Runtime dictionary | `0x06000`–`0x0FFEF`, grows up; ceiling `0xFFF0` |
| Boot ROM | `0x0FFFF0`–`0x0FFFFF` |
| Unmapped PSRAM | the upper 1 M words of die 0 are not in the 20-bit CPU window |

The 24K image is copied from user flash/packed BSRAM into PSRAM `0x0000`–
`0x5FFF`; the loader verifies the CRC and reads the 24K window back. The
dictionary probe at `0x6000` moves `HERE` into PSRAM; on a non-PSRAM/B RAM-only
build the probe fails and the dictionary stays below the BIOS.

### 8.2 User flash (on-die FLASH608K)

| Item | Value |
|---|---|
| Size | 608 Kbit = 76 KB = `0x13000` bytes |
| Header | 8 × 32-bit words at flash words 0..7 |
| Header fields | magic `'D16F'` `0x44313646`, format 1, image length 24,576 words, CRC-16/CCITT-FALSE, build id, reserved |
| Flat image | flash words 64..12,351; two 16-bit CPU words per 32-bit flash word |
| Remainder | `0xFF` |
| Installer pages | 25 × 2 KB |

The boot loader reads the header, copies 12,288 32-bit words as 24,576 PSRAM
words, checks the CRC, reads every flash word back and compares, retries once,
and then hands `0x0100` to the core. A bad header/CRC or a persistent mismatch
sets `boot_err` and holds the core (LED heartbeat steady).

### 8.3 FPGA configuration flash

The `.fs` bitstream (e.g. `deep16_board_tile_flash.fs`) goes to the **external
SPI configuration flash** with `openFPGALoader -f`; it is not CPU-addressable.
The on-die user flash is written separately with
`--user-flash artifacts/image/image.flash.bin`. Both are persistent; the `.fs`
and `image.flash.bin` must come from the same build.

### 8.4 BSRAM (physical, not the CPU map)

The PSRAM board stores the **range-packed** 16K-word boot image in BSRAM plus
the PSRAM tag cache, UART FIFO, and the tile/sprite banks. The BRAM-only
D16MINI variant uses 24K words of BSRAM as CPU memory (`0x0000`–`0x5FFF`).
These are physical allocations; the CPU sees PSRAM at the addresses above.

---

## 9. Vectors and boot flow

1. Reset: `CS=0xFFFF`, `PC=0` → `0xFFFF0` boot ROM.
2. Boot ROM zeroes DS/SS, loads `0x0100` into R1, writes the entry at physical
   0..2, jumps to `0000:0100`.
3. Kernel starts at `0x0100`, installs the SWI vector at `0x0002`, clears the
   console, probes `0x6000` for PSRAM, and moves `HERE`/the dictionary if present.
4. The baked boot script at `boot_script` is interpreted from `boot_ptr`; its
   definitions (`free`, `mem`, `demo`, and the D16nano `divtest` header) are added
   to the dictionary.
5. REPL/BIOS: SWI dispatches through `bios_entry` (0 bver, 1 binit, 2 putch,
   3 putstr, 4 getch, 5 getstr, 6 gfx on D16D).
6. ILL trap: `deep16_core3` raises the trap for DIV/DIV32; the D16nano handler at
   `0x5000` emulates the divide, saves the caller's PC in `ill_pc_save`
   (`0x37E4`), and returns. `divtest` at `0x5300` checks it.

---

## 10. Fill and unbacked addresses

* RAM/PSRAM outside the image is `0xFFFF` (halt word) on the simulation and the
  loaded PSRAM; the image loader is responsible for the 24K window.
* A read of an address the selected board does not back returns `0xFFFF`.
* A store to an unbacked `0xFxxxx` address is dropped.
* `0xF0064` is the notable build difference: ordinary RAM on the 1 MiB screen
  build, unbacked on the 24K UART boards.
* The boot ROM at `0xFFFF0` is a LUT; it is not part of the image and cannot be
  overwritten.
