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
                        { defines: { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1, D16D: 1 } });
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
function line(text, cap = 40_000_000) {
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
  // The boot script loads the SD driver (slices 1..3) and the catalog
  // (slices 5..8) from the config flash; the directory lists all three.
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
  // 40 is scratch space: the low indices hold the boot objects (sd, hello,
  // catalog, games) and the game images, and a flushed slice overwrites its
  // whole sector.
  line('40 3 slice-create');
  line('s" test" slice-name!');
  line('slice-flush');
  assert.equal(number(line('40 slice slice-type . cr'), '40 slice slice-type . cr'), 3);
  line('40 dir-add');
  assert.match(line('dir'), /test/);
  assert.equal(number(line('s" test" find . cr'), 's" test" find . cr'), 40);
  assert.ok(sim.running);
});

test('a directory entry can be removed', () => {
  line('40 dir-remove');
  assert.doesNotMatch(line('dir'), /\btest\b/);
  assert.equal(number(line('s" test" find . cr'), 's" test" find . cr'), -1);
  assert.ok(sim.running);
});

test('the I2S words load from the catalog', () => {
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
  for (const ch of '1 2') sim.uartRxPush(ch.charCodeAt(0));
  for (let i = 0; i < 2_000_000; i++) step(1);
  assert.equal(ds(sym.tib_kbd) & 0xff, 0x31, 'first character');
  assert.equal(ds(sym.tib_kbd + 1) & 0xff, 0x20, 'space');
  assert.equal(ds(sym.tib_kbd + 2) & 0xff, 0x32, 'second character');
  assert.equal(out.slice(from).includes(' ok'), false, 'nothing ran before Return');
  const done = out.length;
  sim.uartRxPush(13);
  for (let i = 0; i < 5_000_000; i++) step(1);
  assert.match(out.slice(done), / ok/, 'Return completed the line');
  line('drop drop');
  assert.ok(sim.running);
});

test('the catalog\'s ATTR cell is the kernel\'s text_attr', () => {
  // The catalog is Forth source and cannot see assembler symbols, so the cell
  // is a literal there. Pin the two together or a kernel edit silently makes
  // ATTR write the wrong cell (it did once).
  const src = fs.readFileSync(path.join(ROOT, 'screens', 'flash', 'catalog.fth'), 'utf8');
  const m = src.match(/0x([0-9A-Fa-f]+) constant text-attr/);
  assert.ok(m, 'the catalog defines text-attr');
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

// ---- the flash game loader ---------------------------------------------
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
  for (const ch of 's" pacman" game-run\n') sim.uartRxPush(ch === '\n' ? 13 : ch.charCodeAt(0));
  let frame = 0, at = -1, sent = 0;
  for (let i = 0; i < 40_000_000; i++) {
    step(1);
    if (at < 0 && sim.segmentRegisters.CS === SEG) at = i;
    if (at >= 0 && (i - at) % 0x400 === 0) {
      frame++;
      // `d` walks Pac-Man right down the open row; the far call must run the
      // block with a pristine PSW (the kernel's ER=8 would make its R8 loads
      // read ES instead of DS and no direction would ever apply).
      if (frame === 340 && !sent) { sim.uartRxPush(0x64); sent = 1; }
      if (frame === 420 && sent === 1) { sim.uartRxPush(0x71); sent = 2; }  // q
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
