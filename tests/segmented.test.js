// The segmented map (`D16SEG`) in the JS core.
//
// The tile/user-flash build no longer runs from the flat 24K image: the loader
// scatters the data and the BIOS into segments (rtl/flash/flash_boot.sv), and
// the kernel runs with CS=0, DS=0x1000, SS=0x2000, BIOS CS=0x3000. Nothing else
// covers that map, so this boots the same scattered memory in the JS core and
// exercises the parts the map can break: the dictionary, the data stack, the
// return stack, the SD driver and source loaded from a card.
//
// The scatter below mirrors flash_boot.sv with D16SEG:
//   - the flat image at 0x00000 (kernel code, vectors, ILL/divtest code)
//   - image words 0x3000..0x57DC at DS 0x1000 (kernel data, BIOS/demo data)
//   - image words 0x4A00..0x57FF at CS 0x3000 (BIOS code + demo)
// The rest of PSRAM is erased (0xFFFF), like the model and a fresh part.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, loadBrowserScripts, MEM_WORDS, ROOT } from './helpers.js';
import { buildSlices, SCREEN_BASE, SLICE_WORDS } from '../scripts/make_slices.mjs';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const WINDOW = 0x6000;
const DS_SEG = 0x1000;
const SS_SEG = 0x2000;
const BIOS_SEG = 0x3000;
const DS_LO = 0x3000;          // first image word copied to DS
const DS_HI = 0x57dc;          // last one flash_boot copies
const BIOS_LO = 0x4a00;        // the BIOS/demo block in the flat image
const BIOS_HI = 0x57ff;
// The return stack is a DS window: LD/ST through DS is the only way the kernel
// reaches it, so it cannot be a segment of its own.
const RSTACK_TOP = 0x2ff0;

const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
                        // D16D matches the board build; `text_attr` is the cell
                        // the catalog's ATTR words write (see the check below).
                        { defines: { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1, D16D: 1,
                                     CONSOLE_MIRROR: 1 } });
const sym = kernel.symbols;

function scattered() {
  const mem = new Array(MEM_WORDS).fill(0xffff);
  for (const c of kernel.memoryChanges) {
    if (c.address < WINDOW) mem[c.address] = c.value & 0xffff;
  }
  const img = (a) => mem[a];
  for (let w = DS_LO; w <= DS_HI; w++) mem[(DS_SEG << 4) + w] = img(w);
  for (let w = BIOS_LO; w <= BIOS_HI; w++) mem[(BIOS_SEG << 4) + (w - BIOS_LO)] = img(w);
  return mem;
}

const slices = buildSlices();
const helloFirst = slices.manifest.objects.hello.first;
const sim = new globalThis.Deep16Simulator();
sim.loadProgram(scattered());
sim.spiFlash.mem.set(slices.bytes, SCREEN_BASE);
sim.segmentRegisters.CS = 0xffff;   // the boot ROM zeroes DS/SS and enters 0:0x0100
sim.running = true;

let out = '';
function step(n) {
  for (let i = 0; i < n; i++) {
    if (!sim.running) return false;
    sim.step();
    if (sim.uartTx.length) out += String.fromCharCode(...sim.uartTxTake());
  }
  return true;
}

// Type a line and run until the prompt comes back, or the cap runs out.
function line(text, cap = 40_000_000) {
  const from = out.length;
  for (const ch of `${text}\n`) sim.kbdBuffer.push(ch === '\n' ? 13 : ch.charCodeAt(0));
  for (let i = 0; i < cap; i++) {
    step(1);
    if (!sim.running) break;
    if (out.indexOf('\r\n> ', from) >= 0) break;
  }
  return out.slice(from);
}

// The number a `... . cr` line printed, after the echoed input.
function number(echoed, text) {
  const rest = echoed.slice(echoed.lastIndexOf(text) + text.length);
  const m = rest.match(/^\s+(-?\d+)\s+\r?\n/);
  assert.ok(m, `no number after ${JSON.stringify(text)} in ${JSON.stringify(echoed)}`);
  return Number(m[1]);
}

const boot = (() => {
  // The boot compiles the SD driver and the whole catalog from flash with the
  // Forth interpreter (find is a linear scan, so the cost grows with the
  // dictionary): 22M steps today, and the cap leaves headroom for a few more
  // catalog slices.
  for (let i = 0; i < 60_000_000 && !out.includes('> '); i++) step(1);
  return out;
})();
// The kernel's cells live in DS=0x1000, not in the flat copy the assembler wrote
// at 0x0000-0x5FFF, so every symbol read has to go through the segment.
const ds = (addr) => sim.memory[(DS_SEG << 4) + addr];
const here = () => ds(sym.dp_var);
const limit = () => ds(sym.dict_limit_var);

test('the scattered image boots into the segmented map', () => {
  assert.match(boot, /Hello DeepForth!/);
  assert.equal(sim.segmentRegisters.DS, DS_SEG, 'DS');
  assert.equal(sim.segmentRegisters.SS, SS_SEG, 'SS');
  assert.equal(ds(sym.rp0_base), RSTACK_TOP, 'return stack top');
  assert.equal(ds(sym.rp_ptr), RSTACK_TOP, 'return stack pointer');
  assert.equal(ds(sym.sp_top), 0xfff0, 'data stack top');
  assert.equal(ds(sym.dict_base_var), 0x5800, 'dictionary base');
});

test('the dictionary is the PSRAM segment and reports its free count', () => {
  assert.ok(boot.includes(`${limit() - here()} free`), 'the summary prints free = limit - here');
  assert.ok(here() >= 0x5800 && here() < limit(), 'here is inside the dictionary range');
});

test('the config flash identifies and the directory is readable', () => {
  // The boot loader brings up start, essentials and edit from the config
  // flash; the directory lists every object.
  assert.match(boot, /> /);
  const id = line('cf-id');
  assert.match(id, /85 60 16/);
  const d = line('dir');
  assert.match(d, /hello/);
  assert.match(d, /essentials/);
  assert.match(d, /graphics/);
  assert.match(d, /sd-card/);
});

test('the assembly block reader streams a whole slice', () => {
  // cf-burst is the kernel primitive behind cf-read-burst; it reads 4 KB
  // through the SPI master. Compare the header and first payload word with
  // the flash model. The hello source starts at helloFirst.
  const off = SCREEN_BASE + helloFirst * 4096;
  const header = sim.spiFlash.mem[off] | (sim.spiFlash.mem[off + 1] << 8);
  const payload = sim.spiFlash.mem[off + 16] | (sim.spiFlash.mem[off + 17] << 8);
  const t1 = `${helloFirst} 512 + slice-buf cf-burst slice-buf @ . cr`;
  assert.equal(number(line(t1), t1), header);
  const t2 = 'slice-buf 8 cells + @ . cr';
  assert.equal(number(line(t2), t2), payload);
  assert.ok(sim.running);
});

test('screen loads the hello slice', () => {
  assert.match(line(`${helloFirst} screen`), / ok/);
  assert.match(line('hello'), /hello from the user flash/);
  assert.ok(sim.running);
});

test('a slice payload can be printed from flash to the terminal', () => {
  // `slice` reads the 4 KB sector into slice-buf; the payload starts at cell 8.
  // The manifest length, not 2040: the latter would print the LF padding too.
  const echoed = line(`${helloFirst} slice 8 cells + ${slices.manifest.objects.hello.chars} type`);
  assert.match(echoed, /hello from the user flash/);
  assert.ok(sim.running);
});

test('a slice created and flushed reads back and enters the directory', () => {
  // 40 is scratch space: the low indices hold the boot objects (start,
  // essentials, edit, graphics, games, sd-card), the game images and hello;
  // a flushed slice overwrites its whole sector. Type 0x0C is a block screen.
  line('40 0x0C slice-create');
  line('s" test" slice-name!');
  line('slice-flush');
  assert.equal(number(line('40 slice slice-type . cr'), '40 slice slice-type . cr'), 0x0C);
  line('40 dir-add');
  assert.match(line('dir'), /test/);
  assert.equal(number(line('s" test" find . cr'), 's" test" find . cr'), 40);
  assert.ok(sim.running);
});

// Type a command line, then queue raw keys for a word that reads `key` (the
// slice editor). The command's CR goes first, so the keys stay in the FIFO
// until the editor starts.
function lineWithKeys(text, keys, cap = 60_000_000) {
  const from = out.length;
  for (const ch of `${text}\n`) sim.kbdBuffer.push(ch === '\n' ? 13 : ch.charCodeAt(0));
  for (const k of keys) sim.kbdBuffer.push(k);
  for (let i = 0; i < cap; i++) {
    step(1);
    if (!sim.running) break;
    if (out.indexOf('\r\n> ', from) >= 0) break;
  }
  return out.slice(from);
}

test('type-slice prints the printable payload and trims the LF padding', () => {
  const echoed = line(`${helloFirst} type-slice`);
  assert.match(echoed, /hello from the user flash/);
  assert.ok(sim.running);
});

test('type-slice pages 23 lines and waits for a key', () => {
  const from = out.length;
  for (const ch of '4 type-slice\n') sim.kbdBuffer.push(ch === '\n' ? 13 : ch.charCodeAt(0));
  const pages = () => (out.slice(from).match(/-- more --/g) || []).length;
  for (let i = 0; i < 30_000_000 && pages() === 0; i++) step(1);
  assert.equal(pages(), 1, 'the first page stops with -- more --');
  let seen = pages();
  for (let p = 0; p < 40 && !out.endsWith('> '); p++) {
    sim.kbdBuffer.push(0x20);
    for (let i = 0; i < 20_000_000; i++) {
      step(1);
      if (out.endsWith('> ') || pages() > seen) break;
    }
    seen = pages();
  }
  assert.ok(out.endsWith('> '), 'the interpreter is back after the pages');
  assert.ok(seen > 1, 'at least one more page was shown');
  sim.kbdBuffer.length = 0;                  // no page keys may leak into later tests
  assert.equal(number(line('depth . cr'), 'depth . cr'), 0, 'type-slice leaves the stack clean');
});

test('edit-slice draws the first tile row without scrolling', () => {
  const TILE = 0xF1000;
  const cell = (r, c) => sim.memory[TILE + r * 82 + c] & 0x0FFF;
  const glyph = (ch) => (ch.charCodeAt(0) - 0x20) * 32;
  line('45 0x0C slice-create');
  line('slice-buf 8 cells + 2040 65 fill');
  line('slice-flush');
  for (const ch of '45 edit-slice\n') sim.kbdBuffer.push(ch === '\n' ? 13 : ch.charCodeAt(0));
  for (let i = 0; i < 4_000_000 && (cell(0, 0) !== glyph('A') || cell(23, 0) !== glyph('A')); i++) step(1);
  assert.equal(cell(0, 0), glyph('A'), 'the first row is visible');
  assert.equal(cell(23, 0), glyph('A'), 'the last row is visible');
  assert.equal(ds(sym.tile_off), 0, 'the editor did not scroll');
  sim.kbdBuffer.push(0x18, 0x03);            // C-X C-C: discard and exit
  for (let i = 0; i < 4_000_000 && !out.endsWith('> '); i++) step(1);
  assert.ok(out.endsWith('> '), 'edit-slice returned to the prompt');
  assert.equal(number(line('depth . cr'), 'depth . cr'), 0, 'edit-slice leaves the stack clean');
});

test('edit-slice overwrites at the cursor and Ctrl-X Ctrl-S saves', () => {
  // Slice 40 was created and flushed by the previous test. C-F (right), D at
  // 1, C-A (home), A at 0, C-X C-S.
  const echoed = lineWithKeys('40 edit-slice',
                              [0x06, 'D'.charCodeAt(0), 0x01, 'A'.charCodeAt(0), 0x18, 0x13]);
  assert.match(echoed, /slice written/);
  assert.equal(number(line('40 slice 8 cells + c@ . cr'),
                      '40 slice 8 cells + c@ . cr'), 65, 'A saved at 0');
  assert.equal(number(line('40 slice 8 cells + 1+ c@ . cr'),
                      '40 slice 8 cells + 1+ c@ . cr'), 68, 'D saved at 1');
});

test('edit-slice Ctrl-X Ctrl-C leaves the flash unchanged', () => {
  const echoed = lineWithKeys('40 edit-slice',
                              ['Z'.charCodeAt(0), 0x18, 0x03]);
  assert.match(echoed, /discarded/);
  assert.equal(number(line('40 slice 8 cells + c@ . cr'),
                      '40 slice 8 cells + c@ . cr'), 65, 'still A, not Z');
});

test('edit-slice Return moves to column 1 of the next line', () => {
  // Slice 40 still has A at 0. Return moves to 80 (row 1, column 1), then R
  // overwrites that cell; C-X C-S saves.
  const echoed = lineWithKeys('40 edit-slice',
                              [0x0d, 'R'.charCodeAt(0), 0x18, 0x13]);
  assert.match(echoed, /slice written/);
  assert.equal(number(line('40 slice 8 cells + 80 + c@ . cr'),
                      '40 slice 8 cells + 80 + c@ . cr'), 82, 'R at row 1, col 1');
  assert.equal(number(line('40 slice 8 cells + c@ . cr'),
                      '40 slice 8 cells + c@ . cr'), 65, 'row 0 still A');
});

test('text-edit inserts and joins LF-terminated text', () => {
  line('46 3 slice-create');
  for (const [i, c] of [...'abc\ndef'].entries()) {
    line(`${c.charCodeAt(0)} slice-buf 8 cells + ${i ? `${i} +` : ''} c!`);
  }
  line('slice-flush');
  // End, X inserts at the line end; Down/Home/Backspace join the lines;
  // C-X C-S saves.
  const echoed = lineWithKeys('46 text-edit',
                              [0x05, 0x58, 0x0e, 0x01, 0x7f, 0x18, 0x13]);
  assert.match(echoed, /slice written/);
  const shown = line('46 slice 8 cells + 7 type');
  assert.match(shown, /abcXdef/, 'the inserted X and the joined line are saved');
  assert.equal(number(line('46 slice 8 cells + 7 + c@ . cr'),
                       '46 slice 8 cells + 7 + c@ . cr'), 10, 'the saved text ends in LF');
  assert.equal(number(line('depth . cr'), 'depth . cr'), 0, 'text-edit leaves the stack clean');
});

test('text-edit deletes forward with C-D', () => {
  line('47 3 slice-create');
  for (const [i, c] of [...'abc\ndef'].entries()) {
    line(`${c.charCodeAt(0)} slice-buf 8 cells + ${i ? `${i} +` : ''} c!`);
  }
  line('slice-flush');
  const echoed = lineWithKeys('47 text-edit', [0x01, 0x04, 0x18, 0x13]);
  assert.match(echoed, /slice written/);
  const shown = line('47 slice 8 cells + 7 type');
  assert.match(shown, /bc\ndef/, 'C-D removed the character under the cursor');
  assert.equal(number(line('depth . cr'), 'depth . cr'), 0, 'text-edit leaves the stack clean');
});

test('text-edit normalizes CRLF text to LF on save', () => {
  line('48 3 slice-create');
  for (const [i, c] of [0x61, 0x0d, 0x0a, 0x62].entries()) {
    line(`${c} slice-buf 8 cells + ${i ? `${i} +` : ''} c!`);
  }
  line('slice-flush');
  lineWithKeys('48 text-edit', [0x18, 0x13]);
  assert.equal(number(line('48 slice 8 cells + c@ . cr'), '48 slice 8 cells + c@ . cr'), 0x61);
  assert.equal(number(line('48 slice 8 cells + 1+ c@ . cr'), '48 slice 8 cells + 1+ c@ . cr'), 10,
               'the CR is gone');
  assert.equal(number(line('48 slice 8 cells + 2 + c@ . cr'), '48 slice 8 cells + 2 + c@ . cr'), 0x62);
  assert.equal(number(line('depth . cr'), 'depth . cr'), 0, 'text-edit leaves the stack clean');
});

test('the editors refuse the wrong slice type', () => {
  assert.match(line('40 text-edit'), /not a text slice/);
  assert.match(line(`${helloFirst} edit-slice`), /not a screen slice/);
  assert.ok(sim.running);
});

test('serial interprets the UART stream until Ctrl-D', () => {
  // The REPL echoes what it reads and runs the line through `evaluate`. The
  // typed characters go to the serial stream only; the result reaches it too
  // because `serial` raises ECHO_FLAG bit 7 while it evaluates.
  for (const ch of '2 3 + .\r') sim.uartRxPush(ch.charCodeAt(0));
  sim.uartRxPush(0x04);
  const captured = line('serial');
  assert.match(captured, /2 3 \+ \.\r\n5/, 'the typed line and its result');
  assert.ok(sim.running);
  assert.equal(sim.memory[0xF0064] & 0x80, 0, 'the serial mirror bit is cleared');
});

test('serial catches a bad line and keeps going', () => {
  for (const ch of 'nonesuch\r4 5 + .\r') sim.uartRxPush(ch.charCodeAt(0));
  sim.uartRxPush(0x04);
  const captured = line('serial');
  assert.match(captured, /error -13/, 'undefined word is reported');
  assert.match(captured, /9/, 'the next line still runs');
  assert.ok(sim.running);
});

// XMODEM CRC-16 (poly 0x1021, initial 0), high byte first on the wire.
function xmodemCrc(buf) {
  let crc = 0;
  for (const b of buf) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xffff) : ((crc << 1) & 0xffff);
    }
  }
  return crc & 0xffff;
}

function xmodemPackets(src) {
  const data = Buffer.from(src, 'latin1');
  const out = [];
  let blk = 1;
  for (let off = 0; off < data.length; off += 128) {
    const d = Buffer.alloc(128, 0x1a);
    data.copy(d, 0, off, Math.min(off + 128, data.length));
    const crc = xmodemCrc(d);
    out.push(0x01, blk, 0xff ^ blk, ...d, crc >> 8, crc & 0xff);
    blk = (blk + 1) & 0xff;
  }
  out.push(0x04);
  return out;
}

// Type a command on the console (keyboard FIFO) while feeding the serial
// stream a byte at a time. The UART RX FIFO is 128 bytes and a packet is 134,
// so a real sender must be paced, not preloaded in one go.
function lineFeed(text, bytes, cap = 40_000_000) {
  const from = out.length;
  for (const ch of `${text}\n`) sim.kbdBuffer.push(ch === '\n' ? 13 : ch.charCodeAt(0));
  let fed = 0;
  for (let i = 0; i < cap; i++) {
    while (fed < bytes.length && sim.uartRx.length < 100) sim.uartRxPush(bytes[fed++]);
    step(1);
    if (!sim.running) break;
    if (out.indexOf('\r\n> ', from) >= 0) break;
  }
  return out.slice(from);
}

test('xmodem receives a CRC file and runs it directly', () => {
  const src = ': xm-ok ." xmodem ok" cr ; xm-ok\n';
  const echoed = lineFeed('xmodem', xmodemPackets(src));
  assert.match(echoed, /xmodem ok/);
  assert.ok(sim.running);
});

test('a directory entry can be removed', () => {
  line('40 dir-remove');
  assert.doesNotMatch(line('dir'), /\btest\b/);
  assert.equal(number(line('s" test" find . cr'), 's" test" find . cr'), -1);
  assert.ok(sim.running);
});

test('the I2S words load from graphics', () => {
  line('s" graphics" need');
  assert.match(line('sound'), /I2S level/);
  line('beep');
  assert.ok(sim.running);
  line('sfx-off');
  assert.ok(sim.running);
});

test('getstr is a pump: Return completes the line the REPL is polling for', () => {
  // The BIOS drains the FIFO and returns; the REPL polls it with the caller's
  // PSW restored, so the timer and raster IRQs are serviced while it waits.
  // A line typed without Return must sit in TIB and not run.
  const from = out.length;
  for (const ch of '1 2') sim.kbdBuffer.push(ch.charCodeAt(0));
  for (let i = 0; i < 2_000_000; i++) step(1);
  assert.equal(ds(sym.tib_kbd) & 0xff, 0x31, 'first character');
  assert.equal(ds(sym.tib_kbd + 1) & 0xff, 0x20, 'space');
  assert.equal(ds(sym.tib_kbd + 2) & 0xff, 0x32, 'second character');
  assert.equal(out.slice(from).includes(' ok'), false, 'nothing ran before Return');
  const done = out.length;
  sim.kbdBuffer.push(13);
  for (let i = 0; i < 5_000_000; i++) step(1);
  assert.match(out.slice(done), / ok/, 'Return completed the line');
  line('drop drop');
  assert.ok(sim.running);
});

test('the catalog\'s ATTR cell is the kernel\'s text_attr', () => {
  // The catalog is Forth source and cannot see assembler symbols, so the cell
  // is a literal there. Pin the two together or a kernel edit silently makes
  // ATTR write the wrong cell (it did once).
  const src = fs.readFileSync(path.join(ROOT, 'screens', 'flash', 'essentials.fth'), 'utf8');
  const m = src.match(/0x([0-9A-Fa-f]+) constant text-attr/);
  assert.ok(m, 'essentials defines text-attr');
  assert.equal(parseInt(m[1], 16), sym.text_attr, 'catalog constant matches the kernel symbol');
});

test('the palette words write the three banks and the console pair', () => {
  line('0x1C 0xFC 3 pal!');
  assert.equal(sim.memory[0xF6086], 0x1C, 'text pair 3 paper (entry 6)');
  assert.equal(sim.memory[0xF6087], 0xFC, 'text pair 3 ink (entry 7)');
  line('0x03 0xFF 0 art-pal!');
  assert.equal(sim.memory[0xF6090], 0x03, 'art pair 0 paper');
  assert.equal(sim.memory[0xF6091], 0xFF, 'art pair 0 ink');
  line('0xE0 0x1C 5 sprite-pal!');
  assert.equal(sim.memory[0xF60AA], 0xE0, 'sprite pair 5 paper (entry 10)');
  assert.equal(sim.memory[0xF60AB], 0x1C, 'sprite pair 5 ink (entry 11)');
  line('5 attr');
  assert.equal(ds(sym.text_attr), 0xD000, 'ATTR composes 0x8000 | pair << 12');
  assert.equal(number(line('attr@ . cr'), 'attr@ . cr'), 5);

  // STYLE preserves the pair; ATTR preserves the style; ATTR! sets both.
  line('4 style');
  assert.equal(ds(sym.text_attr), 0xD004, 'STYLE adds underline bit 2');
  assert.equal(number(line('style@ . cr'), 'style@ . cr'), 4);
  line('2 style');
  assert.equal(ds(sym.text_attr), 0xD002, 'STYLE replaces underline with bold bit 1');
  line('5 6 attr!');
  assert.equal(ds(sym.text_attr), 0xD006, 'ATTR! sets pair 5 and both style bits');
  assert.equal(number(line('attr@ . cr'), 'attr@ . cr'), 5);
  assert.equal(number(line('style@ . cr'), 'style@ . cr'), 6);
  line('0 attr');
  assert.equal(ds(sym.text_attr), 0x8006, 'ATTR keeps the style bits');
  line('0 style');
  assert.equal(ds(sym.text_attr), 0x8000, 'STYLE 0 clears the style bits');
  line('1 style');
  assert.equal(ds(sym.text_attr), 0x8001, 'STYLE adds the italic page bit 0');
  assert.equal(number(line('style@ . cr'), 'style@ . cr'), 1);
  line('0 style');
  assert.ok(sim.running);
});

test('the block protect is settable and clearable', () => {
  assert.equal(number(line('cf-status 0x38 and . cr'), 'cf-status 0x38 and . cr'), 0);
  line('cf-protect');
  assert.equal(number(line('cf-status 0x38 and . cr'), 'cf-status 0x38 and . cr'), 0x38);
  line('cf-unprotect');
  assert.equal(number(line('cf-status 0x38 and . cr'), 'cf-status 0x38 and . cr'), 0);
});

test('a packed screen unpacks with p-screen', () => {
  line('41 8 slice-create');
  line('s" pair" slice-name!');
  line('slice-flush');
  assert.match(line('41 0 p-screen'), / ok/);
  assert.match(line('41 1 p-screen'), / ok/);
  assert.ok(sim.running);
});

test('arithmetic still works in the new segments', () => {
  const t = line('1 2 + . cr');
  assert.equal(number(t, '1 2 + . cr'), 3);
});

test('deep recursion does not walk into the dictionary', () => {
  // The return stack used to start at 0x5FF0 with the dictionary growing up
  // from 0x5800: ~300 calls of headroom, so this line overwrote the word it was
  // running and froze the machine.
  line(': deep ( n -- ) dup 0= if drop exit then dup 1- recurse ;');
  const t = line('1000 deep depth . cr');
  assert.equal(number(t, '1000 deep depth . cr'), 1000);
  assert.ok(sim.running, 'the machine is still running after 1000 nested calls');
  line(': clear-stack ( -- ) depth 0 ?do drop loop ;');
  line('clear-stack');
});

test('the dictionary is intact after the recursion test', () => {
  const t = line(': sq ( n -- n2 ) dup * ;');
  assert.match(t, / ok/);
  assert.equal(number(line('7 sq . cr'), '7 sq . cr'), 49);
});

test('catch and throw still unwind the return stack', () => {
  line(': boom ( -- ) 42 throw ;');
  const t = line("' boom catch . cr");
  assert.equal(number(t, "' boom catch . cr"), 42);
  assert.ok(sim.running);
});

test('the 64K data stack holds 18000 cells', () => {
  // The data stack grows down from 0xFFF0 and the dictionary up from 0x5800.
  // The tools slice (edit/serial/xmodem) leaves ~19.8K cells free, so 18K
  // leaves a safe margin while still proving the stack is not the old 300-cell
  // return stack.
  line(': push-n ( n -- ) 0 ?do i loop ;');
  line(': drop-n ( n -- ) 0 ?do drop loop ;');
  assert.equal(number(line('18000 push-n depth . cr'), '18000 push-n depth . cr'), 18000);
  assert.equal(number(line('18000 drop-n depth . cr'), '18000 drop-n depth . cr'), 0);
  assert.ok(sim.running);
});

// ---- SD card --------------------------------------------------------------
// The card is on SPI CS0 (0xF0080) and the simulator models it byte by byte
// (SdCard in js/deep16_simulator.js), so these run the driver's own command
// framing, token waiting and busy polling against a card that answers.

test('the SD driver identifies the card', () => {
  line('s" sd-card" need');
  const t = line('sd');
  assert.match(t, /SD card ready/);
  assert.equal(number(line('sd-init . cr'), 'sd-init . cr'), 0);
});

test('a sector written comes back', () => {
  line('65 sd-buf c! 5 sd-buf 1+ c!');
  assert.equal(number(line('3 sd-write . cr'), '3 sd-write . cr'), 0);
  line('0 sd-buf c! 0 sd-buf 1+ c!');
  assert.equal(number(line('3 sd-read . cr'), '3 sd-read . cr'), 0);
  assert.equal(number(line('sd-buf c@ . cr'), 'sd-buf c@ . cr'), 65);
  assert.equal(number(line('sd-buf 1+ c@ . cr'), 'sd-buf 1+ c@ . cr'), 5);
});

test('block reads on a miss and save-block writes the buffer back', () => {
  const first = line('9 block drop sd-buf c@ . cr');
  assert.equal(number(first, '9 block drop sd-buf c@ . cr'), 0, 'sector 9 starts blank');
  line('65 sd-buf c!');
  assert.equal(number(line('save-block . cr'), 'save-block . cr'), 0);
  line('-1 blk ! 0 sd-buf c!');
  const again = line('9 block drop sd-buf c@ . cr');
  assert.equal(number(again, '9 block drop sd-buf c@ . cr'), 65, 'reads it back');
  assert.ok(sim.running);
});

test('a card that never answers is reported, not hung on', () => {
  sim.sdCard = null;                       // nothing drives MISO
  // The driver retries CMD0 three times with a full response timeout, so the
  // give-up path is a few million instructions; give the line room.
  assert.match(line('sd', 60_000_000), /SD init error 1/);
  assert.equal(number(line('sd-r1 @ . cr'), 'sd-r1 @ . cr'), 255, 'the raw byte was the idle bus');
  assert.ok(sim.running);
  sim.sdCard = new globalThis.SdCard();
  assert.equal(number(line('sd-init . cr'), 'sd-init . cr'), 0, 'recovers');
});

test('a seven-sector source file loads from the card and runs', () => {
  // The starfield used to be baked into the boot script. It lives on the card
  // now (screens/starfield.fth): seven sectors, one `include`, and `demo` runs.
  const text = fs.readFileSync(path.join(ROOT, 'screens', 'starfield.fth'));
  const sectors = Math.ceil(text.length / 512);
  for (let k = 0; k < sectors; k++) {
    const sec = sim.sdCard.sector(20 + k);
    for (let i = 0; i < 512; i++) sec[i] = 10;                     // LF padding
    for (let i = 0; i < 512; i++) {
      const at = k * 512 + i;
      if (at < text.length) sec[i] = text[at];
    }
  }
  assert.match(line(`20 ${sectors} include`), / ok/);
  // The xt is an address and prints signed: the boot script's 2 KB screen
  // buffer pushes the card-loaded definitions past 0x7FFF.
  assert.match(line("' demo . cr"), /' demo \. cr -?\d+ /, 'demo was not defined');

  out = '';
  for (const ch of 'demo\n') sim.kbdBuffer.push(ch === '\n' ? 13 : ch.charCodeAt(0));
  for (let i = 0; i < 3_000_000 && sim.running; i++) step(1);
  assert.ok(out.includes('\x1b[?1049h'), 'no alternate screen');
  assert.ok(!out.includes('\x1b[?1049l'), 'stopped before the key');
  const moves = [...out.matchAll(/\x1b\[(\d+);(\d+)H/g)];
  assert.ok(moves.length > 100, `only ${moves.length} cursor moves`);
  for (const m of moves) {
    assert.ok(+m[1] >= 1 && +m[1] <= 24, `row ${m[1]} off screen`);
    assert.ok(+m[2] >= 1 && +m[2] <= 79, `column ${m[2]} off screen (80 wraps)`);
  }
  assert.equal((out.match(/\r\n/g) || []).length, 0, 'the canvas hard-wrapped');

  sim.kbdBuffer.push(32);
  for (let i = 0; i < 3_000_000 && sim.running; i++) step(1);
  assert.ok(out.includes('\x1b[?1049l'), 'did not leave the alternate screen');
  assert.match(out.slice(-40), /\r\n ok\r\n> $/);
});

test('the timer SIC takes vector 1 and the handler counts ticks', () => {
  // irq-on enables the timer bit. The step loop polls the level at instruction
  // boundaries, exactly like the core's ID-stage entry, so the pending source
  // is taken as soon as the enable write retires.
  line('irq-off');
  line('0 sic-scratch es!');
  assert.equal(number(line('ticks . cr'), 'ticks . cr'), 0);

  sim.raiseIRQ(1);
  line('irq-on');
  assert.equal(number(line('ticks . cr'), 'ticks . cr'), 1, 'one tick was handled');
  assert.equal(sim.sicPending & 2, 0, 'the timer bit was cleared');
  assert.equal(number(line('irq? . cr'), 'irq? . cr'), 0, 'no source left pending');

  line('irq-off');
  assert.equal(sim.sicEnable, 0, 'irq-off clears ENABLE');
});

test('W1C clears only the bits written', () => {
  sim.raiseIRQ(0);
  sim.raiseIRQ(1);
  sim.raiseIRQ(2);
  line('2 irq-clear');
  assert.equal(sim.sicPending, 0b101, 'keyboard and audio stay pending');
  line('5 irq-clear');
  assert.equal(sim.sicPending, 0);
  assert.ok(sim.running);
});

test('the raster band multiplexes sprite descriptor 0 at A and restores it at B', () => {
  // The handler cannot read control 7 back (the tile window is write-only), so
  // it keeps the armed line in split-cur. Drive the two visits directly and
  // check the scene write and the re-arm each time.
  line('split-off');
  line('20 0xCC es! 16 15 60 split!');
  const splitCur = () => sim.memory[0xF00C6];
  const scene = () => sim.memory[0xF200A];      // control 5 (base scene)
  const oam1 = () => sim.memory[0xF6001];       // descriptor 0, word 1
  const compare = () => sim.memory[0xF200E];    // control 7
  assert.equal(splitCur(), 15, 'armed at lineA');
  assert.equal(sim.sicEnable & 8, 8, 'raster source enabled');

  sim.raiseIRQ(3);                       // the compare at lineA
  line('1 drop');                        // the interpreter runs with I=1
  assert.equal(oam1(), 0x0800 | 16, 'lower sprite below the split');
  assert.equal(compare(), 60, 're-armed at lineB');
  assert.equal(splitCur(), 60, 'software copy follows');

  sim.raiseIRQ(3);                       // the compare at lineB
  line('1 drop');
  assert.equal(oam1(), 0x0800 | 20, 'upper sprite restored');
  assert.equal(compare(), 15, 're-armed at lineA');
  assert.equal(splitCur(), 15, 'software copy follows');

  line('split-off');
  assert.equal(splitCur(), 0, 'split-off clears the armed line');
});

test('the raster SIC source increments RASTER and outranks the timer', () => {
  line('irq-off');
  line('0 sic-scratch es!');
  line('0 sic-raster es!');
  line('100 raster-line!');
  assert.equal(number(line('raster-ticks . cr'), 'raster-ticks . cr'), 0);

  sim.raiseIRQ(3);
  line('raster-on');
  assert.equal(number(line('raster-ticks . cr'), 'raster-ticks . cr'), 1, 'one raster handled');
  assert.equal(sim.sicPending & 8, 0, 'the raster bit was cleared');
  assert.equal(number(line('irq? . cr'), 'irq? . cr'), 0, 'no source left pending');

  // Both sources enabled and pending: the handler services raster first and
  // leaves the timer bit set; the level re-enters for the timer.
  sim.raiseIRQ(1);
  sim.raiseIRQ(3);
  line('10 sic-enable es!');
  assert.equal(number(line('raster-ticks . cr'), 'raster-ticks . cr'), 2);
  assert.equal(number(line('ticks . cr'), 'ticks . cr'), 1);
  assert.equal(sim.sicPending, 0, 'both bits cleared');
  line('irq-off');
  assert.equal(sim.sicEnable, 0);
});

test('the keyboard IRQ drains the hardware FIFO into the BIOS ring', () => {
  line('irq-off');
  sim.sicPending = 0;
  sim.kbdBuffer.length = 0;
  for (const k of [0x41, 0x42, 0x43, 0x0d]) sim.kbdBuffer.push(k);
  // The console now reads the same keyboard FIFO, so do not type a command
  // here: enter the handler directly and let it drain the four queued keys.
  sim.sicEnable = 1;
  sim.sicPending = 1;
  sim.handleHardwareInterrupt(1);
  for (let i = 0; i < 5000 && sim.running; i++) step(1);
  // The ring is the DS copy of image window 0x52C0; the IRQ vector runs at CS=0
  // and BIOS function 12 runs with DS=0x1000, so both use this copy.
  const bio = (a) => sim.memory[(DS_SEG << 4) + a];
  assert.equal(bio(sym.kbd_head), 0, 'head back at 0');
  assert.equal(bio(sym.kbd_tail), 4, 'four keys queued');
  assert.deepEqual([0, 1, 2, 3].map((i) => bio(sym.kbd_ring + i)),
                   [0x41, 0x42, 0x43, 0x0d], 'ring preserves the key order');
  assert.equal(sim.sicPending & 1, 0, 'keyboard bit cleared');
  assert.equal(sim.kbdBuffer.length, 0, 'hardware FIFO drained');
  line('irq-off');
});

// ---- the flash game loader ---------------------------------------------
// The loader is in games.fth and is loaded on demand.
test('need games loads the flash game loader', () => {
  assert.match(line('s" games" need'), / ok/);
  assert.ok(sim.running);
});

// Phase 2: the Pac-Man block is no longer baked into the image. `game-load`
// finds the type-4 slice, copies its chain into the load segment (0x2000) and
// returns the segment; `game-run` then far-calls it.
test('game-load copies the pacman binary slice into its segment', () => {
  const man = slices.manifest.objects.pacman;
  const base = man.first * SLICE_WORDS;
  const seg = slices.words[base + 12];
  assert.equal(slices.words[base + 8], 0xd16b, 'slice magic');
  assert.equal(slices.words[base + 9], 1, 'slice version');
  assert.equal(seg, 0x2000, 'load segment');
  const count = slices.words[base + 11];
  assert.equal(count, man.words);

  // Make the test independent of any earlier copy.
  for (let a = 0; a < count; a++) sim.memory[(seg << 4) + a] = 0xdead;
  const before = here();
  line('s" pacman" game-load drop');
  // The block may span slices: payload word i sits at cell 8 of slice
  // i / 2040, offset i % 2040. The block word a is payload word 5 + a.
  const payload = (i) => {
    const n = Math.floor(i / 2040);
    return slices.words[(man.first + n) * SLICE_WORDS + 8 + (i % 2040)];
  };
  for (const a of [0, 1, 0x100, 0x600, 0x1000, count - 1]) {
    assert.equal(sim.memory[(seg << 4) + a], payload(5 + a),
                 `block word 0x${a.toString(16)}`);
  }
  assert.equal(here(), before, 'the dictionary is untouched');
  assert.equal(sim.segmentRegisters.ES, 0xf000, 'ES is the I/O segment again');
});

test('call-far enters a segment and returns to the interpreter', () => {
  // A one-word stub at segment 0x4000 offset 0 (0x3000 holds the BIOS):
  // `JML R10`, the far return pair
  // that call-far leaves in R10/R11. The delay slot is a NOP. Coming back must
  // restore DS/SS/ES and carry on with the next word in the caller's thread.
  const seg = 0x4000;
  sim.memory[(seg << 4) + 0] = 0xffea;   // JML R10
  sim.memory[(seg << 4) + 1] = 0x0000;   // NOP (delay slot)
  const t = line('0x4000 call-far depth . cr');
  assert.equal(number(t, '0x4000 call-far depth . cr'), 0);
  assert.equal(sim.segmentRegisters.DS, DS_SEG, 'DS');
  assert.equal(sim.segmentRegisters.SS, SS_SEG, 'SS');
  assert.equal(sim.segmentRegisters.ES, 0xf000, 'ES');
  assert.ok(sim.running);
});

test('game-run starts pacman from flash and returns to the prompt', () => {
  // The far call leaves the kernel's thread and Pac-Man takes over segment
  // 0x2000 with its own DS. It waits for the frame toggle in the status word,
  // and `q` far-returns to the loader. The status bit 3 marks a queued key.
  const SEG = 0x2000;
  const state = (a) => sim.memory[(SEG << 4) + a];
  const from = out.length;
  for (const ch of 's" pacman" game-run\n') sim.kbdBuffer.push(ch === '\n' ? 13 : ch.charCodeAt(0));
  let frame = 0, at = -1, sent = 0;
  for (let i = 0; i < 40_000_000; i++) {
    step(1);
    if (at < 0 && sim.segmentRegisters.CS === SEG) at = i;
    if (at >= 0 && (i - at) % 0x400 === 0) {
      frame++;
      // `d` walks Pac-Man right down the open row; the far call must run the
      // block with a pristine PSW (the kernel's ER=8 would make its R8 loads
      // read ES instead of DS and no direction would ever apply).
      if (frame === 340 && !sent) { sim.kbdBuffer.push(0x64); sent = 1; }
      if (frame === 420 && sent === 1) { sim.kbdBuffer.push(0x71); sent = 2; }  // q
      sim.memory[0xF0066] = ((frame & 1) ? 2 : 0) | (sim.uartRxAvailable() ? 8 : 0);
    }
    if (out.indexOf('\r\n> ', from) >= 0) break;
  }
  assert.match(out.slice(from), /\r\n> /, 'the interpreter is back');
  // The maze is in the tilemap, so the block really ran.
  let tiles = 0;
  for (let r = 0; r < 26; r++) for (let c = 0; c < 82; c++) {
    if ((sim.memory[0xF1000 + r * 82 + c] & 0xfff) !== 0) tiles++;
  }
  assert.ok(tiles > 1000, `the maze was drawn (${tiles} tiles)`);
  assert.ok(state(0x6a5) < 250, 'the maze was drawn and dots were eaten');
  assert.ok(state(0x6a0) > 17, `Pac-Man moved right (column ${state(0x6a0)})`);
  assert.equal(sim.segmentRegisters.DS, DS_SEG, 'DS back to the kernel');
  assert.equal(sim.segmentRegisters.SS, SS_SEG, 'SS back to the kernel');
  assert.equal(sim.segmentRegisters.ES, 0xf000, 'ES back to the I/O segment');
  assert.ok(sim.running);
});

test('the PS/2 init lives in the BIOS and binit calls it', () => {
  // Phase B moved the sender out of a flash slice: functions 7/8 and the
  // 0x5490 block are the only copy now, and binit (function 1) runs the init.
  assert.equal(sym.BIOS_FN_COUNT, 13, '0..5 console + 6 gfx + 7/8 PS/2 + 9/10 SFX + 11 pump + 12 kbd');
  assert.ok(sym.bios_f7 >= sym.bios_entry && sym.bios_f7 < 0x5800, 'f7 inside the BIOS');
  assert.ok(sym.bios_f8 >= sym.bios_entry && sym.bios_f8 < 0x5800, 'f8 inside the BIOS');
  assert.ok(sym.ps2_r5 >= 0x5490 && sym.ps2_r5 < 0x5800, 'saved cells inside the BIOS gap');
  assert.ok(sym.dict_free <= 0x434f, `the kernel dictionary did not grow past 0x434F (${sym.dict_free.toString(16)})`);

  // The cells sit at a fixed .org after the routine; growing the routine must
  // not run into them (a .org silently rewinds and overwrites code).
  const lastCode = Math.max(...kernel.memoryChanges
    .filter((c) => c.address >= 0x5490 && c.address < sym.ps2_r5)
    .map((c) => c.address));
  assert.ok(lastCode < sym.ps2_r5,
    `PS/2 code 0x${lastCode.toString(16)} runs into the cells at 0x${sym.ps2_r5.toString(16)}`);

  // binit's call sits between bios_f1 and bios_f2, not in f8.
  const at = (name) => sym[name];
  const calls = kernel.listing.filter((row) => typeof row.address === 'number'
    && row.address >= at('bios_f1') && row.address < at('bios_f2')
    && /LDI ps2_init - BIOS_BASE/.test(row.line || ''));
  assert.equal(calls.length, 1, 'binit calls ps2_init once');

  // The simulator guard is the 0xFFFF comparison, not the CLK/DATA levels.
  const src = fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8');
  assert.match(src, /CMP R7, R4\s*\n\s*JZ ps2_init_done/, 'ps2_init keeps the erased-memory guard');
});
