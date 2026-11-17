# USBKBPLAN — USB keyboard via a MAX3421E host shield

Status: **design note, not implemented (2026-11-17).** The keyboard today is
PS/2: `rtl/ps2_rx.sv`, the German map, and `ps2_send`/`ps2_init` in the BIOS
(`PS2PLAN.md`). This note records what swapping it for a USB host shield with a
MAX3421E would take. It is not a commitment to build it; §10 lists two cheaper
alternatives.

## 1. What the shield does and does not do

The MAX3421E (EHJ = TQFP-32) is a USB 2.0 **full-speed host controller** with an
SPI interface. It contains the USB transceiver, the serial interface engine, the
packet FIFOs, the 12 MHz clock and the bus timing. It does **not** contain a USB
host stack: chip reset, enumeration, control transfers, HID class handling and
report parsing are all software.

So the swap removes the RTL receiver (roughly 300 lines plus one BSRAM map) and
adds a few kilobytes of driver. The FPGA stops doing bit timing and starts doing
USB protocol. That trade is the whole of this plan.

Limits to keep in mind before starting:

- Full-speed (12 Mbit/s) and low-speed only.
- One device on the bus, no hubs; a keyboard behind a hub will not enumerate.
- No isochronous transfers (irrelevant for keyboards).
- Boot protocol is the easy path; NKRO and many gaming keyboards refuse it and
  need a report-descriptor parser (§8).

## 2. The contract to preserve

The receiver's only job is to turn key events into Latin-1 bytes and push them
into the architectural keyboard FIFO. Everything above that stays.

```
today:  PS/2 keyboard -> ps2_rx -> ps2_key -> KBD FIFO 0xF0060/62
                                          \-> UART RX FIFO (control 6 bit 11,
                                              off by default)
                                            -> BIOS getch / irq_keyboard ring
                                            -> console and games

after:  USB keyboard -> MAX3421E -> SPI -> driver (flash slice / BDOS)
                                         -> write 0xF0062 -> same FIFO
```

On D16nano `bios_f4` polls `KBD_STATUS`/`KBD_DATA` directly; `irq_keyboard`
drains the same FIFO into the 32-entry ring at `0x52C0`; the games read the FIFO.
If the driver produces the same bytes, none of that changes.

## 3. Hardware

### 3.1 Wiring

Exact pin names vary by shield (the common Arduino "USB Host Shield 2.0" clone
uses D10 for CS and D9 for INT). Verify against the silkscreen and schematic.

| Signal | Shield | D16nano | Notes |
|---|---|---|---|
| SCK  | SPI SCK  | FPGA 36 (`spi_sck`)  | shared with the SD socket |
| MOSI | SPI MOSI | FPGA 37 (`spi_mosi`) | shared |
| MISO | SPI MISO | FPGA 39 (`spi_miso`) | shared; only one CS asserted at a time |
| CS   | D10      | new pin             | third chip select |
| INT  | D9       | new pin             | optional if `HIRQ` is polled |
| RESET| shield reset | tie high        | reset over SPI with `USBCTL.CHIPRES` |
| 5 V  | 5 V      | J6 pin 18, or external | shield LDO and keyboard VBUS |
| GND  | GND      | J6 pin 23           | common ground |

The shield is Arduino-shaped and will not stack on the Nano; use jumper wires.

### 3.2 Levels and power

- The MAX3421E is a 3.3 V part. The shield's level shifters are there for 5 V
  Unos: drive the **3.3 V side**, or bypass the shifter. The GW1NR-9 absolute
  maximum I/O voltage is 3.75 V (DS117); do not drive the shield's 5 V header
  side with 3.3 V and rely on the shifter's threshold.
- Check the shield's VBUS arrangement. If VBUS is switched by `GPX`, that pin is
  controlled through `IOPINS` over SPI, so no extra FPGA pin is needed. If VBUS
  is hardwired to 5 V, verify 5 V on the A socket before debugging software.
- Keyboards may draw up to 500 mA from VBUS. J6 pin 18 is tied to the Nano's
  USB-C VBUS; a separate 5 V supply with a common ground is the safe
  arrangement. Watch for back-powering either board through its 5 V pin.
- `RESET` can stay high: `USBCTL.CHIPRES` resets the chip over SPI. If you prefer
  a pin, it costs one output.

### 3.3 Pins

The minimal delta is **one** pin (CS) if `HIRQ` is polled and VBUS is hardwired;
two pins (CS + INT) if connect/disconnect interrupts are wanted.

Pins 76/77 (the PS/2 clock/data pads) free up when the mini-DIN socket goes, but
they are physically on the socket. Prefer a free header pin and confirm the
silicon pin number, bank and VCCIO against the Sipeed pinout before adding an
`IO_LOC`.

### 3.4 SPI compatibility

`deep16_spi` is mode 0, MSB first, byte-wide, full duplex — the same protocol the
MAX3421E expects. `SPI_DIV` resets to 0 (3.375 MHz at 6.75 MHz), comfortably
below the MAX3421E's 26 MHz maximum. No new SPI engine is needed, which matters
because the design has no room for one (§6).

## 4. RTL changes

1. **Third chip select.** Widen `deep16_spi`'s CS field (`SPI_CTRL` bit 2, plus
   the status bits) and add a third pin set in `deep16_board.sv`. While there,
   rework the clock mux: today `cfg_sck` is driven whenever CS1 is deasserted
   (`cfg_sel = ~spi_cs_i[1]`). Make each target's clock conditional on its own
   select, then rerun the config-flash read/program tests.
2. **INT input** with `PULL_MODE=UP` in the `.cst`. RESET only if not using
   `CHIPRES`.
3. **A keyboard injection port.** This is the piece that is easy to miss:
   `0xF0060/62` is read-only today. The console's `bios_f4` polls
   `KBD_STATUS`/`KBD_DATA`, and `irq_keyboard` drains the same FIFO, so a software
   driver currently has no way to deliver a character. Add a write decode at
   `0xF0062` that pushes the low byte into the FIFO (one comparator and a mux).
   The console, the IRQ ring and the games then work unchanged.
4. **Remove `ps2_rx`**, its 2048 x 8 BSRAM map, the BIOS `ps2_send`/`ps2_init`
   block, and the `0xF0066` clock/data debug bits — or keep them behind a define.
   Keeping both is not viable (§6). Also retire the `0x200C` bits 9/10 drive
   paths and the control 6 bit 11 UART gate if PS/2 goes for good.
5. **HID to ASCII in software.** HID usage IDs (page 0x07) are physical
   positions, like Set-2 codes, so `scripts/make_ps2map.mjs` can generate a
   128-entry German QWERTZ table from usages. A software table costs no BSRAM and
   no CLS. A pROM like `ps2map` is the alternative if the driver cannot afford
   the lookup time; one BSRAM block would be free.
6. Nothing in the netlist speaks USB: that is the point of the MAX3421E.

## 5. Software

### 5.1 Where it runs

Not the BIOS. `LAYERPLAN.md` is explicit that SWI runs with `I=0`, so a
multi-second enumeration would freeze the raster, audio and timer IRQs; the BIOS
also has no room (the PS/2 block ends at `0x57E0` and `0x57E0`-`0x57FF` is
data). Put the driver in a flash slice or in BDOS, loaded by the boot script,
like `sd-card`, and write it as a non-blocking state machine.

### 5.2 Chip bring-up

1. Pulse `USBCTL.CHIPRES`, wait about 1 ms.
2. `OSCON`, then wait for `USBIRQ.OSCOKIRQ`.
3. `PINCTL`: full-duplex SPI, interrupt level as wanted.
4. `MODE`: host mode, SOF generation, DP pull-up.
5. `HCTL.BUSRST`, wait for it to clear (the chip holds the reset for ~20 ms).
6. Enable VBUS through `GPX`/`IOPINS` if the shield is wired that way.

### 5.3 Enumeration

- The transport is a command byte, `(register << 3) | write`, then one data byte;
  reads and writes are full duplex.
- Transfers go through `HXFR` with SETUP/IN/OUT and are checked in `HRSL`;
  `HIRQ` reports completion and errors. Expect NAK, timeout, STALL and babble
  paths even on a good keyboard.
- Sequence: 8-byte device descriptor at address 0, `SET_ADDRESS`, full
  configuration descriptor, find the HID interface and its interrupt-IN endpoint,
  `SET_CONFIGURATION`, `SET_IDLE(0)`, `SET_PROTOCOL(boot)`.

### 5.4 Reports and the map

- Boot report is 8 bytes: modifiers, reserved, six usage IDs. Modifier bit 0 is
  LCtrl, 1 LShift, 2 LAlt, 5 RShift, 6 RAlt (AltGr).
- Diff the report against the previous one to get make/break events. Ignore
  usage `0x01` (rollover error) and the POST-fail codes.
- Map usage plus `{ctrl, caps, shift, alt}` to Latin-1, preserving the German
  QWERTZ behaviour and the AltGr punctuation the PS/2 map provides today.
- Push the resulting byte through the `0xF0062` injection port; the hardware
  FIFO and the IRQ ring take it from there.

### 5.5 Scheduling and hot-plug

- Poll the interrupt endpoint at its `bInterval` (typically 8-10 ms), either from
  the ~1 kHz timer IRQ or from a non-blocking console hook. One report is about
  ten SPI bytes, tens of microseconds at 3.375 MHz.
- On connect/disconnect, reset the bus and re-enumerate. USB is hot-pluggable,
  unlike PS/2, but the re-enumeration is code that has to exist.
- Time out cleanly. `binit` currently calls `ps2_init`; remove that call, and
  make sure `cls` (which repeats `binit`) and a keyboardless boot still reach the
  prompt without waiting for a device.

## 6. Fit

The current tile build is nearly full:

| Resource | Used | Total | Free |
|---|---|---|---|
| CLS | 4,316 | 4,320 | 4 |
| Logic | 8,283 | 8,640 | 357 |
| BSRAM | 23 | 26 | 3 |

This is why the swap has to be a swap: the PS/2 receiver, its map and the BIOS
init come out to make room for the third CS, the INT pin and the injection port.
Even though the USB protocol lives off-chip, the RTL is not free.

The BIOS software side is also full. `ps2_send`/`ps2_init` occupy `0x5490` up to
`0x57E0`; the dictionary ends at `0x434F` and the image has one word of slack
before the frogger block at `0x4350`. A USB stack must not go there.

## 7. Work breakdown

| Workstream | What | Time |
|---|---|---|
| Wiring and power | 3.3 V side, VBUS, CS/INT, shared SPI | 1/2 day |
| RTL | third CS, INT, inject port, delete PS/2, re-mux, fit and timing | 1 day |
| Register layer | SPI access, chip init, bus reset | 1-2 days |
| Enumeration | control transfers, descriptors, configuration, HID | 3-5 days |
| HID and integration | map, injection, IRQ scheduling, hot-plug, boot without keyboard | 2-4 days |
| Tests and bring-up | map tests, SPI-level stub, scope, board verification | part of the above |

Total: **about 1.5-2.5 weeks** of focused work for someone who has written USB
enumeration before. The wiring and RTL are roughly one day of it; the host stack
is the project.

## 8. Caveats

- **Boot protocol only** for v1. A keyboard that refuses `SET_PROTOCOL(boot)`
  needs the HID report descriptor parsed (variable/array fields, report IDs,
  usage ranges), which is a second project.
- **No hubs**, one device. A monitor's USB ports are a hub.
- **Power.** Keyboards can exceed what the Nano's USB-C feed should supply. The
  shield's own LDO is fine; the VBUS current is the question.
- **Level shifting.** Feeding 3.3 V into the 5 V side of the shield's shifter is
  the most likely first failure. Check the schematic, not the silkscreen.
- **Placement.** Removing `ps2_rx` changes the netlist; the `uart_push_en` mux
  note in `HARDWARE.md` (a hard tie cost 15 CLS) shows how sensitive this build
  is. Re-run place and route and the timing report, not just lint.

## 9. Testing

- There is no USB device model in the JS core. `npm run sim:ps2` becomes a
  HID-map unit test (report bytes in, Latin-1 out).
- Add an SPI-level MAX3421E stub (registers and a canned descriptor set) so the
  driver's state machine can be tested without a board: reset, enumeration
  order, NAK/retry, disconnect.
- Retire `tests/ps2-bios.test.js` if PS/2 goes; keep it if both paths stay.
- Add the new ports to `npm run lint:board` and the injected key path to the
  console tests.
- Board bring-up: scope SCK/CS/INT, meter VBUS, then check the first descriptor
  read before attempting the HID report loop.

## 10. Alternatives

- **USB-to-PS/2 adapter.** Zero work, keeps every line of RTL and BIOS. Check
  that it handles the German layout and its own keyboard init, and that it is
  not a keyboard-only converter that needs a PC host.
- **Pico/RP2040 USB host -> PS/2 device emulation.** TinyUSB host on one side,
  PS/2 device emulation on the other, plugged into the existing mini-DIN. An
  afternoon, keeps all existing RTL and BIOS, and handles hubs and hot-plug in
  the Pico. The pragmatic route if the goal is typing on a USB keyboard rather
  than building a USB host in the FPGA.
- **MAX3421E.** The only option that stays in the FPGA and needs no second MCU.
  Worth it if that is the goal; otherwise the Pico bridge is cheaper in every
  sense.

## 11. First slice

A bounded first step that proves the path before the full driver:

1. RTL: third CS, INT, `0xF0062` injection port, PS/2 behind a define.
2. Software: SPI register read/write, `CHIPRES`, `OSCON`, host mode, bus reset,
   and a printed device descriptor (VID/PID, `bMaxPacketSize0`).
3. Verify: scope SPI, confirm `OSCOKIRQ`, see a real descriptor on the console.
4. Then: configuration, HID interface, boot report, map.

If step 3 does not produce a descriptor, the problem is wiring, levels or VBUS,
and no amount of HID work will help.

## 12. Open questions

- Which shield exactly (level shifters, VBUS switch, CS/INT pinout)? The plan
  assumes the common Arduino host shield; verify before ordering pins.
- Should PS/2 remain as a fallback behind a build define, or be removed?
- Are the free header pins on the actual board revision in a 3.3 V bank?
- Is boot protocol acceptable, or must NKRO keyboards work?
