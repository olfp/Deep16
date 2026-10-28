# Archived: the 24K BSRAM builds

Retired 2026-10-28. The Tang Nano 9K runs the **tile/user-flash build**
(`deep16_board_tile_flash`, `npm run synth:tile` / `npm run flash:tile`) on
PSRAM, so the builds that ran the whole machine out of the 24K-word BSRAM window
are no longer needed. Nothing here is built or tested by the current tree.

What is here:

| file | was |
|---|---|
| `fpga/deep16_board.gprj` | D16MINI text build: 24K BSRAM window, no PSRAM |
| `fpga/deep16_board_flash.gprj` | D16MINI text build booting the kernel from user flash |
| `fpga/deep16_board_tile.gprj` | the packed-image tile experiment (16-block image, 24K window) |
| `scripts/build_board_sim.sh` | `npm run sim:board`: Verilator board sim for the 24K build |
| `scripts/build_flash_sim.sh` | `npm run sim:flash`: the user-flash boot regression on the 24K build |
| `scripts/synth_board.sh`, `build_gowin*.sh`, `flash_board.sh`, `flash_gowin_flash.sh` | the Gowin flows for those builds |
| `rtl/sim/board_tb.cpp` | the UART/PS2 board testbench (`sim:board`) |
| `rtl/sim/psram_boot_tb.*` | an older PSRAM boot testbench, already stale |

What still exists in the live tree and is *not* 24K-specific:

- `rtl/deep16_top.sv` keeps the `D16MINI` / non-PSRAM paths as dead code for the
  simulator, and `rtl/deep16_board.cst` still constrains the pins; both are
  shared with the tile build.
- `asm/forth.asm` is still the kernel of the screen/IDE build and of
  `tests/boot-script.test.js`; only the 24K *board* targets went away.
- `rtl/sim/uart_tx_tb`, `spi_tb`, `timer_tb`, `ps2_rx_tb` and the core tests are
  unaffected.

Why the split: the 24K window has no room for the SD driver's buffers next to
the boot script (dictionary below the BIOS at `0x5600`), and the board build has
PSRAM where those buffers are free. The 24K build was only ever a bring-up step
and a regression harness.

To bring a target back, move its file back into `fpga/gowin/`, `scripts/` or
`rtl/sim/` and restore the matching `package.json` script.
