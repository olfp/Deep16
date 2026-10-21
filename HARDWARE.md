# Hardware notes

## USB keyboard attachment (DVI + keyboard step)

For attaching a USB keyboard to the Tang Nano 9K without a separate
microcontroller, consider the **usb_hid_host** FPGA core:

- Repo: https://github.com/nand2mario/usb_hid_host
- Compact USB HID host core supporting **keyboards, mice, and gamepads**.
- **No CPU required** — all-in-one design; reports keystrokes directly.
- Small footprint: **< 300 LUTs, < 250 registers, 1 BRAM block** — fits the
  Tang Nano 9K budget (and is much lighter than a Pi Pico / external MCU).
- Vendor-agnostic Verilog; includes a Tang Nano 9K/20K sample project.
- Also has a companion **usb_host_pmod** board for pmod-style connections.

Integration: add `usb_hid_host.v`, `usb_hid_host_rom.v`, and
`usb_hid_host_rom.hex` to the build, wire the USB data lines to a free
header/pmod, and feed the reported key codes into the existing keyboard
FIFO (`0xF0060`/`0xF0062`) — keeping the ASCII/scan-code contract the
BIOS and Forth kernel already expect.

This is the preferred lightweight alternative to an external USB-host MCU
(Pi Pico, STM32, etc.) for the standalone DVI + keyboard build.
