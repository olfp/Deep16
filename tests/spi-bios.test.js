// Atomic SPI BIOS primitives (functions 20/21/22) on the segmented map.
//
// The point of these functions is that a BDOS driver can drive the config
// flash with I=1: each call sets a register, starts a byte, or reports one
// finished byte, and never waits.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, loadBrowserScripts, MEM_WORDS, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
                        { defines: { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1 } });
const DS = 0x1000;
const BIOS = 0x3000;
const HALT = 0x0480;

function machine() {
  const mem = new Array(MEM_WORDS).fill(0xFFFF);
  for (const c of kernel.memoryChanges) if (c.address < 0x6000) mem[c.address] = c.value & 0xffff;
  for (let w = 0x3000; w <= 0x57dc; w++) mem[(DS << 4) + w] = mem[w];
  for (let w = 0x4a00; w <= 0x57ff; w++) mem[(BIOS << 4) + (w - 0x4a00)] = mem[w];
  mem[HALT] = 0xFFFF;
  mem[2] = kernel.symbols.swi_to_bios;

  const stub = assemble(`
        .org 0x0100
        LDI 2
        MOV R1, R0            ; CS1 asserted
        LDI 5
        MOV R2, R0            ; divider
        LDI 20
        SWI                   ; spi-ctrl
        LDI 0x9F
        MOV R1, R0            ; JEDEC id
        LDI 21
        SWI                   ; spi-start
        LDI 22
        SWI                   ; spi-poll
        SMV R0, AR0
        SMV R1, AR1
        HALT
  `);
  assert.equal(stub.success, true, stub.errors?.join('; '));
  for (const c of stub.memoryChanges) mem[c.address] = c.value & 0xffff;

  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(mem);
  sim.segmentRegisters.CS = 0;
  sim.segmentRegisters.DS = DS;
  sim.segmentRegisters.SS = 0x2000;
  sim.segmentRegisters.ES = 0xF000;
  sim.registers[15] = 0x0100;
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 10000) { sim.step(); steps++; }
  return { sim, steps };
}

test('f20 sets CS and the divider without waiting', () => {
  const { sim } = machine();
  assert.equal(sim.spi.cs, 2, 'CS1 asserted');
  assert.equal(sim.spi.div, 5, 'divider written');
});

test('f21 starts one byte and f22 reports the finished byte', () => {
  const { sim } = machine();
  assert.equal(sim.registers[0] & 0xffff, 1, 'f22 says a byte is ready');
  assert.equal(sim.registers[1] & 0xffff, sim.spi.rx & 0xffff,
               'f22 returns the received byte');
});
