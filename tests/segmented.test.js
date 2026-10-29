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
import { buildSlices, SCREEN_BASE } from '../scripts/make_slices.mjs';

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
                        { defines: { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1 } });
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
function line(text, cap = 12_000_000) {
  const from = out.length;
  for (const ch of `${text}\n`) sim.uartRxPush(ch === '\n' ? 13 : ch.charCodeAt(0));
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
  for (let i = 0; i < 20_000_000 && !out.includes('> '); i++) step(1);
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
  // The boot script loads the SD driver (slices 1..3) and the catalog
  // (slices 5..7) from the config flash; the directory lists all three.
  assert.match(boot, /> /);
  const id = line('cf-id');
  assert.match(id, /85 60 16/);
  const d = line('dir');
  assert.match(d, /hello/);
  assert.match(d, /catalog/);
  assert.match(d, /sd/);
});

test('screen 4 loads the hello slice', () => {
  assert.match(line('4 screen'), / ok/);
  assert.match(line('hello'), /hello from the user flash/);
  assert.ok(sim.running);
});

test('a slice created and flushed reads back and enters the directory', () => {
  line('8 3 slice-create');
  line('s" test" slice-name!');
  line('slice-flush');
  assert.equal(number(line('8 slice slice-type . cr'), '8 slice slice-type . cr'), 3);
  line('8 dir-add');
  assert.match(line('dir'), /test/);
  assert.equal(number(line('s" test" find . cr'), 's" test" find . cr'), 8);
  assert.ok(sim.running);
});

test('a directory entry can be removed', () => {
  line('8 dir-remove');
  assert.doesNotMatch(line('dir'), /\btest\b/);
  assert.equal(number(line('s" test" find . cr'), 's" test" find . cr'), -1);
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
  line('9 8 slice-create');
  line('s" pair" slice-name!');
  line('slice-flush');
  assert.match(line('9 0 p-screen'), / ok/);
  assert.match(line('9 1 p-screen'), / ok/);
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

test('the 64K data stack holds 20000 cells', () => {
  line(': push-n ( n -- ) 0 ?do i loop ;');
  line(': drop-n ( n -- ) 0 ?do drop loop ;');
  assert.equal(number(line('20000 push-n depth . cr'), '20000 push-n depth . cr'), 20000);
  assert.equal(number(line('20000 drop-n depth . cr'), '20000 drop-n depth . cr'), 0);
  assert.ok(sim.running);
});

// ---- SD card --------------------------------------------------------------
// The card is on SPI CS0 (0xF0080) and the simulator models it byte by byte
// (SdCard in js/deep16_simulator.js), so these run the driver's own command
// framing, token waiting and busy polling against a card that answers.

test('the SD driver identifies the card', () => {
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
  for (const ch of 'demo\n') sim.uartRxPush(ch === '\n' ? 13 : ch.charCodeAt(0));
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

  sim.uartRxPush(32);
  for (let i = 0; i < 3_000_000 && sim.running; i++) step(1);
  assert.ok(out.includes('\x1b[?1049l'), 'did not leave the alternate screen');
  assert.match(out.slice(-40), /\r\n ok\r\n> $/);
});
