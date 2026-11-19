// The canonical nano boot loader reads source slices through BDOS function 11.
// This boots the flat nano kernel, counts the read-slice calls, and checks that
// the loaded modules are usable. The segmented board build is covered by
// tests/segmented-showcase.test.js and tests/segmented.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assemble, buildMemory, loadBrowserScripts, ROOT } from './helpers.js';
import { buildSlices, SCREEN_BASE } from '../scripts/make_slices.mjs';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const source = fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8');
const kernel = assemble(source,
  { defines: { CONSOLE_UART: 1, D16NANO: 1, D16D: 1, CONSOLE_MIRROR: 1 } });
assert.equal(kernel.success, true, kernel.errors?.join('; '));
const sym = kernel.symbols;
const slices = buildSlices();

const sim = new globalThis.Deep16Simulator();
sim.loadProgram(buildMemory(kernel));
sim.spiFlash.mem.set(slices.bytes, SCREEN_BASE);
sim.segmentRegisters.CS = 0xFFFF;
sim.segmentRegisters.DS = 0x0000;
sim.segmentRegisters.SS = 0x0000;
sim.segmentRegisters.ES = 0x0000;
sim.running = true;

let text = '';
let readSliceCalls = 0;
let inReadSlice = false;
let doneAt = -1;
for (let i = 0; i < 60_000_000; i++) {
  const pc = sim.registers[15] & 0xFFFF;
  const cs = sim.segmentRegisters.CS & 0xFFFF;
  const at = cs === 0 && pc === sym.bdos_read_slice;
  if (at && !inReadSlice) readSliceCalls++;
  inReadSlice = at;
  sim.step();
  if (sim.uartTx.length) text += String.fromCharCode(...sim.uartTxTake());
  if (doneAt < 0 && sim.memory[sym.boot_done]) doneAt = text.length;
  if (doneAt >= 0 && text.slice(doneAt).includes('> ')) break;
}

test('the nano boot reaches the prompt and loads the modules', () => {
  assert.match(text, /Hello DeepForth!/);
  assert.match(text, /Loading essentials/);
  assert.match(text, /Loading edit/);
  assert.match(text, /free/);
  assert.match(text, /> /);
  assert.ok(readSliceCalls >= 4, `expected BDOS read-slice calls, saw ${readSliceCalls}`);
});

test('the nano boot source reads through BDOS read-slice and keeps cf-burst for tools', () => {
  const boot = fs.readFileSync(path.join(ROOT, 'forth', 'boot.fth'), 'utf8');
  assert.match(boot, /bdos-slice/);
  assert.match(boot, /cf-burst-prim/);
  // The embedded block is generated from that source, not hand-edited.
  const asm = fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8');
  const block = asm.slice(asm.indexOf('; >>> generated from forth/boot.fth'),
                          asm.indexOf('; <<< end generated >>>'));
  assert.match(block, /bdos-slice/);
  assert.match(block, /cf-burst-prim/);
  assert.equal(typeof sym.bdos_read_slice, 'number');
});

test('the nano boot script is current and fits the baked block', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'embed_forth.mjs'), '--check'],
               { cwd: ROOT, stdio: 'pipe' });
  const src = fs.readFileSync(path.join(ROOT, 'forth', 'boot.fth'), 'utf8');
  const code = src.split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('\\'))
    .reduce((n, l) => n + l.length + 1, 0);
  assert.ok(code <= 2040, `forth/boot.fth code is ${code} chars, past one screen`);
});
