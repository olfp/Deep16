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

The vectors are physical `0x0000` (ILL), `0x0001` (hardware IRQ) and `0x0002`
(SWI); the kernel installs all three at run time. `0x0000`–`0x00FF` is the zero
page / boot staging area.

---

## 2. Build profiles

| | Screen / IDE | D16MINI (UART) | D16nano (tile) |
|---|---|---|---|
| CPU image | 1 MiB flat array | 24K-word image, PSRAM-backed | 24K-word config-flash image (1 MB), PSRAM-backed |
| BIOS entry | `0xF8000` | `0x5600` | `0x4A00` |
| Dictionary ceiling | `0x4000` | `0x5600` initially; PSRAM raises it to `0xFFF0` | `0x4A00` initially; PSRAM raises it to `0xFFF0` |
| Return stack top | `0x6F00` (grows down) | `0x5800` (grows down) | `0x5800` (grows down) |
| Data stack top | `0x7FF0` (grows down) | `0x5FF0` (grows down) | `0x5FF0` (grows down) |
| Display | `0xF1000` cell/attribute RAM | DVI text mirror, own cell RAM | `0xF1000` tilemap + tile engine |
| Console | UART `0xF0040` | UART `0xF0040` | UART `0xF0040` |
| Boot script | none | `demo.fth` baked in image | `demo.fth` baked in image |
| D16D showcase | none | none | BIOS segment `0x4A00` (trampoline `0x334`, header `0x3E4`) |

The D16MINI and D16nano images both probe word **`0x6000`**. When it reads back,
the kernel moves `HERE` to `0x6000` and raises the dictionary ceiling to
`0xFFF0` (below the boot ROM), giving roughly 39,000 free words instead of the
few thousand in the 24K window.

Both stacks grow **down**. The flat 24K image puts the return stack top at
`0x5800`, only 144 words above the end of the D16MINI BIOS (`0x576F`) and 1,136
above the D16nano BIOS (`0x538F`): a deeply nested line can overwrite the BIOS.
The `D16SEG` build fixes the layout instead of the constant — see §4.4.

---

## 3. Common map

| Range | Contents |
|---|---|
| `0x00000`–`0x00002` | boot entry staging / SWI vector (runtime; vector at 2) |
| `0x00000`–`0x000FF` | zero page, interrupt vector area |
| `0x00100` | `forth_start`, conventional program/kernel entry |
| `0x0F0020`–`0x0F002F` | timer: 32-bit ms counter, compare, status (D16nano) |
| `0x0F0040`–`0x0F004F` | UART console |
| `0x0F0060`–`0x0F0064` | keyboard FIFO / echo cell (build-specific) |
| `0x0F0068`–`0x0F006B` | D16nano 32-bit CPU cycle counter (read-only) |
| `0x0F0080`–`0x0F008F` | SPI master: SD / external flash (D16nano) |
| `0x0F00A0`–`0x0F00AF` | I2S: DATA/CTRL/STATUS (D16nano) |
| `0x0F1000` | display window (screen RAM or tilemap, build-specific) |
| `0x0F2000`–`0x0F200E` | tile control registers (tile build only) |
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

The D16nano uses a 24,576-word flat image (`0x0000`–`0x5FFF`) in the **config
flash at 1 MB** (`0x100000`), copied to PSRAM at boot by the SPI-master boot
loader. The dictionary then continues at `0x6000`.

| Range | Contents |
|---|---|
| `0x00000`–`0x000FF` | zero page / SWI vector staging |
| `0x00100`–`0x004FF` | kernel block 1 (`forth_start`, built-ins, boot entry) |
| `0x00500`–`0x01FFF` | kernel block 2 (primitives, interpreter, compiler) |
| `0x02000`–`0x02FFF` | threading engine `next` and built-in word code |
| `0x03000`–`0x049F8` | kernel data, boot script, built-in headers, `rp0_base` |
| `0x049F9`–`0x049FF` | static `dict_free` … BIOS (7 words) |
| `0x04A00`–`0x04D2F` | BIOS code (segment `0x04A0`) |
| `0x04D30`–`0x04D33` | free (4 words) |
| `0x04D34`–`0x04D38` | D16D trampoline |
| `0x04D39`–`0x04DE7` | D16D strings, palette, cloud table, header |
| `0x04DE8`–`0x04DFF` | gap |
| `0x04E00`–`0x04ED4` | free (former colour-demo block) |
| `0x04ED5`–`0x04EFE` | game state cells |
| `0x04F00`–`0x04FE0` | menu code and default palette |
| `0x05000`–`0x0519F` | ILL trap handler (DIV/DIV32 emulation) |
| `0x051A0`–`0x051B5` | IRQ handler (hardware vector 1) |
| `0x051B6`–`0x052FF` | free |
| `0x05300`–`0x053FF` | `divtest` word code + string (`divtest_ok_str` at `0x532E`) |
| `0x05400`–`0x057FF` | reserved gap |
| `0x05800`–`0x05FEF` | Forth stacks: return stack from `0x5800` down, data stack from `0x5FF0` down |
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
| `irq_handler` | `0x51A0` | hardware IRQ (vector 1) handler |
| `ill_handler` | `0x5000` | ILL trap handler |
| `word_divtest` | `0x5300` | `divtest` code |
| `divtest_ok_str` | `0x532E` | `divtest ok` string |

The D16D showcase lives in the BIOS segment: a four-word header at `0x3E4`
(`0x0D16`, format 1, entry `0x334`), a trampoline at `0x334`, the menu code at
`0x500` and the game at `0xA00`. BIOS function 6 (`gfx`) checks the header,
parks the Forth R5/R6, jumps to the entry, and on return clears the
tilemap/scroll/OAM/cursor. The board's kernel calls it during boot, so the
menu is the power-on screen (Flappy, Forth, or Flappy automatically after ten
seconds).

### 4.2 D16nano stack cells

* `sp0_base` (`0x3000`) is the data-stack empty/base cell.
* `sp_top` (`0x3001`) holds `0x5FF0`; `SP` starts there and grows down.
* `rp0_base` (`0x49F8`) holds `0x5800`; the return stack grows **down** from
  there, so it descends into the reserved gap at `0x5400`–`0x57FF` and then
  into the BIOS data. It has 1,136 words before it reaches the end of the BIOS
  at `0x538F`.
* The stacks share the `0x5800`–`0x5FFF` window; a deep mixed recursion can
  collide, as on the other builds. The `D16SEG` build gives each stack its own
  window instead (§4.4).

### 4.3 D16nano dictionary

* Static image ends at `dict_free = 0x49F9`; only 7 words remain before the BIOS.
* On PSRAM the boot probe moves `HERE` to `0x6000`; the runtime dictionary and
  the boot-script definitions (`free`, `mem`, `demo`, `divtest` header, etc.)
  live there.
* The ceiling is `0xFFF0`; `free` reports about 39,212 words after the baked
  script definitions (the exact number depends on the script/word set).
* The D16D showcase is **not** in the dictionary; it is a fixed block in the
  BIOS segment of the image/PSRAM.
* The `D16SEG` build moves the dictionary base to `0x5800`, so `free` reports
  about 41,260 words (§4.4).

### 4.4 Segmented map (`D16SEG`, current board)

`D16SEG` is defined in `fpga/gowin/d16tile_flash.sv`; the text and packed
builds keep the flat map above. `rtl/flash/flash_boot.sv` scatters the flat
image into these segments (the CRC covers the flash read; the read-back verify
was dropped for the read port):

| Segment | Physical | Contents |
|---|---|---|
| `CS=0x0000` | `0x00000` | kernel code `0x0100`–`0x2FFF`, zero page/vectors, ILL handler `0x5000`, IRQ handler `0x51A0`, `divtest` `0x5300` |
| `DS=0x1000` | `0x10000` | kernel data and boot script `0x3000`–`0x49F8`; BIOS/demo data `0x4A00`–`0x57DC`; dictionary `0x5800`–`0xFFEF` |
| `SS=0x2000` | `0x20000` | data stack, top `0xFFF0`, 64K words |
| `CS=0x3000` | `0x30000` | BIOS code + D16D showcase, from image `0x4A00`–`0x57FF` |
| `ES=0xF000` | `0xF0000` | MMIO, boot ROM `0xFFFF0`–`0xFFFFF` |

Within `DS=0x1000`:

| Offset | Contents |
|---|---|
| `0x0000`–`0x1FFF` | free: the SD driver keeps its sector buffer in the dictionary instead (`sd-buf`), so this window is still unclaimed |
| `0x2000`–`0x2FFF` | return stack, top `0x2FF0` down, 4,080 frames |
| `0x3000`–`0x49F8` | kernel data, boot script, built-in headers, `rp0_base` |
| `0x4A00`–`0x57DC` | BIOS and D16D data |
| `0x5800`–`0xFFEF` | dictionary, grows up, ~42K words |

Notes:

* The return stack is **not** a segment of its own: `docol`, `exit`, `>r`,
  `r>`, `r@`, `catch`/`throw` and the compile-time branches all reach it with
  `LD`/`ST` through DS, so it has to be a DS offset window. It must stay below
  `0x5800` because the dictionary grows up from there.
* The BIOS and ILL handlers run in the shadow bank with `SS=0`/`DS=0`, so both
  set `DS=0x1000` and `SS=0x2000` on entry.
* The SWI/ILL/IRQ vectors stay at physical `0`/`2`/`1` and are written through `CS=0`.
* The D16D demo keeps its own `DS=0x04A0` (the flat segment-0 copy of the BIOS
  block); BIOS function 6 restores `DS=0x1000` on return.
* `tests/segmented.test.js` boots this map in the JS core (scatter + banner,
  1,000-deep recursion, `catch`/`throw`, 20,000 data-stack cells).

---

## 5. D16MINI UART build

24,576-word image (`0x0000`–`0x5FFF`), PSRAM-backed; same boot-script/PSRAM
dictionary behaviour as D16nano, without the tile engine or D16D showcase.

| Range | Contents |
|---|---|
| `0x00000`–`0x000FF` | zero page / SWI vector |
| `0x00100`–`0x049D5` | kernel image + boot script + built-in headers (`dict_free = 0x49D6`) |
| `0x049D6`–`0x055FF` | dictionary / boot-script growth before BIOS |
| `0x05600`–`0x057FF` | BIOS (segment `0x0560`) |
| `0x05800`–`0x05FEF` | stacks: return `0x5800` down, data `0x5FF0` down |
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

The **D16nano user-flash tile build** now has a one-byte TX holding register:
status bits b1 (TX ready) and b3 (TX idle) are live, and a write to
`UART_DATA` starts an 8N1 byte. The tile console remains the CPU's display;
the UART TX is a second output for a host terminal and for future X/YMODEM
transfers. The D16MINI text build keeps the 64-byte TX FIFO; the older packed
tile build stays RX-only.

### 7.2 Keyboard and echo

| Address | Name | Access | Meaning |
|---|---|---|---|
| `0xF0060` | `KBD_STATUS` | R | b0 data available |
| `0xF0062` | `KBD_DATA` | R | pop a key |
| `0xF0064` | `ECHO_FLAG` | R/W | screen/keyboard echo |

The keyboard FIFO is 16 entries. It is used by the simulation and the
screen/IDE front end, and on the D16nano board it is also written by the PS/2
receiver (`rtl/ps2_rx.sv`): every decoded ASCII byte is pushed into this FIFO
*and* into the UART RX FIFO, so both the architectural keyboard port and the
UART console see the key. The D16nano BIOS still polls the UART, so the PS/2
path needs no BIOS change. `0xF0064` is ordinary RAM in the 1 MiB screen build
but **not backed** on the 24K UART boards: reads return `0xFFFF`, writes are
dropped. The D16nano kernel keeps its console/quiet state in kernel cells
(`boot_quiet`, `line_out`).

### 7.3 D16nano cycle counter and display status

| Address | Meaning |
|---|---|
| `0xF0066` | read-only display status: b0 `vblank`, b1 frame toggle |
| `0xF0068` | low 16 bits of the 32-bit CPU cycle counter (read-only) |
| `0xF006A` | high 16 bits (read-only) |
| `0xF006C`–`0xF006F` | reserved |

`vblank` is the 30-line vertical blank level; the frame bit toggles once per
output frame. Both are synchronised from the pixel domain into the CPU domain.

This is the benchmark time base; it is not a writable register.

### 7.4 FiT tile engine (`D16nano`/`DVI_TILE`)

**FiT** (*Frogger inspired tile-based*) is the 82×26 tile/sprite layer: tilemap,
4bpp tile bank, eight 32×32 sprites, palette banks and text styles.

Each memory has its own 4K-word page; the CPU window is write-through to the
tile engine and the PSRAM/Forth mirror at the same address.

| Address | Window | Contents |
|---|---|---|
| `0xF1000`–`0xF1853` | tilemap | 82×26 16-bit cells: `{mode, pair[2:0], tile[11:0]}`; visible 80×24 plus one-tile margin; two banks |
| `0xF2000` | control 0 | `{row[4:0], col[6:0], enable}` cursor |
| `0xF2002` | control 1 | circular row offset (0..25) |
| `0xF2004` | control 2 | smooth `scroll_x` (0..15), latched with control 4 at the frame boundary |
| `0xF2006` | control 3 | smooth `scroll_y` (0..30) |
| `0xF2008` | control 4 | b0 write bank, b1 display bank (display bank and `scroll_x` swap at the render frame boundary) |
| `0xF200A` | control 5 | sprite **write** page (b1:0): 0 Red, 1 Purple, 2 Yellow; 3 clamps to 0 |
| `0xF200C` | control 6 | per-row fine scroll: `{en, row[4:0], fine[2:0]}`; latched at the frame boundary |
| `0xF200E` | control 7 | raster line compare 0..359 (`b9:0`); one SIC bit-3 pulse per frame |
| `0xF3000`–`0xF3BFF` | tile bank | 96 tiles × 32 words; 30 words of 8×15 4bpp, word 30 palette pointer, word 31 flags |
| `0xF4000`–`0xF47FF` | sprite bank | 8 groups × 16 patterns × 16 words, selected by the control-5 **write** page; the bank holds 24 groups (3 pages), preloaded. The renderer uses the absolute OAM group. |
| `0xF5000`–`0xF500F` | OAM | 8 sprites × 2 words: `w0={behind,vflip,hflip,free,enable,xsign,x[9:0]}`, `w1={group[4:0],free,y[9:0]}` |
| `0xF5080`–`0xF508F` | text palette | 8 pairs: entry `2p` = paper, `2p+1` = ink |
| `0xF5090`–`0xF509F` | art palette | 16 × RGB332 entries for mode-0 tiles |
| `0xF50A0`–`0xF50AF` | sprite palette | 16 × RGB332 entries shared by all eight sprites |
| rest of `0xF5000`–`0xF50FF` | — | reserved |

Tile cell convention: mode 0 (`bit 15 = 0`) is the old art cell, where
`bits 11:0` are a 32-word-aligned tile address and the 4bpp pixel index reads
the art palette. Mode 1 (`bit 15 = 1`) is a text pair cell:
`0x8000 | (pair << 12) | style | ((character - 0x20) * 32)`; `pix[0]` selects
paper (entry `2p`) or ink (entry `2p+1`) from the text bank. The low five bits
are style: bit 2 is generated underline and bit 1 is the bold smear; the tile
address is 32-word aligned, so the fill masks bits 4:0 out of the fetch. The
console's current pair/style lives at `0x3BEE` (`text_attr`), and the catalog
words `PAL!`, `ART-PAL!`, `SPRITE-PAL!`, `ATTR`, `STYLE`, `ATTR!`, `ATTR@` and
`STYLE@` drive it.

A 32×32 sprite is 16 8×8 tiles; `tile = group*16 + (row/8)*4 + column`.
Sprite palette index 0 is transparent; OAM bit 15 puts the sprite behind
background index 0; sprite 0 wins priority. OAM w0 bit 10 marks a negative
sprite x; the compositor biases both x and the beam position by +32, so a
sprite can cross the left edge and be clipped instead of vanishing.

The **DVI tile build** uses the tilemap at `0xF1000`. The **screen build** uses
the same address for its cell/attribute array; the two never coexist. The
**D16MINI UART** build does not back `0xF1000`.

### 7.5 Timer (`0xF0020`–`0xF002F`, D16nano)

A 32-bit millisecond counter with a 32-bit compare, a sticky match flag and a
15 kHz tick (450 cycles at 6.75 MHz). The match flag is polled; the tick drives
SIC pending bit 1. The timer CTRL b2 IRQ-enable bit is still stored but the SIC
does not use it: the SIC ENABLE mask selects the source.

| Address | Name | Access | Meaning |
|---|---|---|---|
| `0xF0020` | `TIMER_CTRL` | R/W | b0 enable, b1 clear match (write), b2 IRQ enable |
| `0xF0022` | `TIMER_VALUE_LO` | R | milliseconds, low 16 bits |
| `0xF0024` | `TIMER_VALUE_HI` | R | milliseconds, high 16 bits |
| `0xF0026` | `TIMER_CMP_LO` | R/W | compare, low 16 bits |
| `0xF0028` | `TIMER_CMP_HI` | R/W | compare, high 16 bits |
| `0xF002A` | `TIMER_STATUS` | R | b0 match, b1 running, b2 IRQ enable |

The counter starts at reset with enable set; the compare resets to
`0xFFFFFFFF`, so a fresh machine never matches until software writes a compare.
At 6.75 MHz the prescaler is 6750 cycles; the 32-bit count wraps after 49.7
days.

### 7.6 SPI master (`0xF0080`–`0xF008F`, D16nano)

One byte-wide mode-0 master, MSB first, with two active-low chip selects. The
protocol (SD commands, flash erase/program, CRC) is software.

| Address | Name | Access | Meaning |
|---|---|---|---|
| `0xF0080` | `SPI_CTRL` | R/W | b1:0 chip selects (1 = asserted; CS0 = SD, CS1 = external flash) |
| `0xF0082` | `SPI_STATUS` | R | b0 busy, b1 done, b3:2 chip selects |
| `0xF0084` | `SPI_DATA` | R/W | write a byte to start; read the byte received last |
| `0xF0086` | `SPI_DIV` | R/W | half-period divider; SCK = CPU clock / (2 × (DIV+1)) |

DIV resets to 0 (3.375 MHz at 6.75 MHz); write 8 for the ~375 kHz SD
initialisation clock. The SD socket is on pins 36 (SCK), 37 (MOSI), 38 (CS0),
39 (MISO); CS1 is pin 25 for an external flash. The on-board configuration
flash is not used.

The Forth side is the **SD driver in the boot script** (`forth/demo.fth`): it
reaches these registers with `es@`/`es!` (ES = `0xF000`), bit-bangs CMD0, CMD8,
CMD55/ACMD41, CMD58 and CMD16 to identify the card, then CMD17/CMD24 for one
512-byte sector at a time. `sd-init`, `sd-read`, `sd-write`, `sd-buf`, `blk`,
`block`, `save-block` and `include` are documented in `FORTH.md`; the sector buffer is 512
cells of dictionary, one character per cell, so it is usable as text directly.
Sector numbers are 16 bits (32 MB of the card).


### 7.7 I2S and the SIC (`0xF00A0`–`0xF00BF`, D16nano)

`0xF00A0`–`0xF00AF` is the I2S block (DATA, CTRL, STATUS and the FIFO). The
SPI config-flash driver uses `0xF0080` and CS1.

The SIC at `0xF00B0` has one level IRQ into core3, with a fixed priority high
to low: raster, audio, timer, keyboard.

| Address | Name | Access | Meaning |
|---|---|---|---|
| `0xF00B0` | `SIC_PENDING` | R / W1C | b3 raster, b2 audio, b1 timer, b0 keyboard; write 1 clears |
| `0xF00B2` | `SIC_ENABLE` | R/W | source mask; IRQ = any pending & enable |
| `0xF00B4` | `SIC_STATUS` | R | b0 IRQ level, b1 any pending (ignores enable) |
| `0xF00B6` | `SIC_SCRATCH` | R/W | the ISR's timer counter (`ticks`) |
| `0xF00B8` | `SIC_RASTER` | R/W | the ISR's raster counter (`raster-ticks`) |

The hardware vector is `0x0001`; the kernel installs `irq_handler` (`0x51A0`)
there at boot. The handler services raster (bit 3) before timer (bit 1): it
clears the serviced bit and increments `SIC_RASTER` or `SIC_SCRATCH`; the
other pending bit stays set and re-enters after `RETI`. Audio and keyboard are
decoded but still tied off. Forth words in the catalog slice: `irq-on` (timer),
`raster-line!` (control 7), `raster-on`/`raster-off`, `irq-off`, `irq-clear`
(mask), `ticks`, `raster-ticks` and `irq?`.
---

## 8. PSRAM and storage

### 8.1 CPU-visible PSRAM

| Item | Value |
|---|---|
| Device | HyperRAM, 64 Mbit package, only die 0 used |
| Physical die | 4 MB = 2 M words |
| CPU-visible window | `0x00000`–`0xFFFFF`, 1 M words = 2 MB |
| Boot image | `0x00000`–`0x05FFF`, 24,576 words |
| D16D showcase | BIOS segment blocks `0x04D34`–`0x057E9` (inside the image) |
| Runtime dictionary | `0x06000`–`0x0FFEF`, grows up; ceiling `0xFFF0` |
| Boot ROM | `0x0FFFF0`–`0x0FFFFF` |
| Unmapped PSRAM | the upper 1 M words of die 0 are not in the 20-bit CPU window |

The 24K image is copied from the config-flash boot image into PSRAM `0x0000`–
`0x5FFF`; the loader checks the image CRC. The dictionary probe at `0x6000`
moves `HERE` into PSRAM; on a non-PSRAM/BSRAM-only build the probe fails and
the dictionary stays below the BIOS.

### 8.2 Boot image (config flash, 1 MB)

| Item | Value |
|---|---|
| Flash byte range | `0x100000`–`0x112FFF` (76 KB = 608 Kbit) |
| Header | 8 × 32-bit words at image words 0..7 |
| Header fields | magic `'D16F'` `0x44313646`, format 1, image length 24,576 words, CRC-16/CCITT-FALSE, build id, reserved |
| Flat image | image words 64..12,351; two 16-bit CPU words per 32-bit flash word |
| Remainder | `0xFF` |
| Transport | mode-0 SPI `0x03` reads through the shared SPI master at boot |

The loader reads the header, copies 12,288 32-bit words as 24,576 PSRAM words,
checks the CRC, and hands `0x0100` to the core. A bad header or CRC sets
`boot_err` and holds the core (LED heartbeat steady). The on-die FLASH608K
read controller was deleted; the on-die flash is now only the installer
fallback (below).

### 8.3 FPGA configuration flash

The `.fs` bitstream (e.g. `deep16_board_tile_flash.fs`) goes to the **external
SPI configuration flash** at byte 0 with `openFPGALoader -f`. The boot image is
written at `0x100000` with `--external-flash -o 0x100000`; the slices follow at
`0x200000`. The CPU reaches the flash only through the SPI master (CS1), not
as memory.

The 2 MB block protect (BP = `0x38`) covers the bitstream and the boot image;
the upper 2 MB (slices) stays writable. `openFPGALoader --unprotect-flash` does
not clear this P25Q32H's BP, so run `cf-unprotect` on the board first
(`cf-status` must read 0); `npm run flash:tile` then writes all three and the
boot script's `cf-protect` re-arms the guard. The script verifies the
`0x100000` image after writing.

The on-die FLASH608K is still available to the installer bitstream
(`npm run installer:tile` / `sim:installer`), but the tile build no longer
reads it.

The upper, writable 2 MB of the config flash (`0x200000`–`0x3FFFFF`, sectors
512–1023) is the **slice area**:

| byte range | contents |
|---|---|
| `0x200000` + `n × 0x1000` | slice `n`, 4 KB = 2048 cells |
| `0x200000` | slice 0: the master directory |
| `0x201000`–`0x203FFF` | slices 1–3: the SD driver source |
| `0x204000` | slice 4: `hello.fth` |
| `0x205000`–`0x208FFF` | slices 5–8: catalog/editor, `p-screen`, sound, palettes |

`scripts/make_slices.mjs` builds `artifacts/image/slices.bin`;
`npm run flash:slices` writes it at `0x200000`. The lower 2 MB (bitstream and
the reserved kernel region) stays under BP = `0x38`, so a slice write cannot
touch it.

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
