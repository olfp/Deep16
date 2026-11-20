// The playable Pole slice: boot it in its own segment, feed steering and Esc,
// and check that the HUD reaches the tilemap and the car accelerated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserScripts, MEM_WORDS } from './helpers.js';
import { assemblePoleGame } from '../scripts/pole_program.mjs';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const game = assemblePoleGame();
const SEG = 0x7000;
const G_SPEED = 0x0520;

function boot() {
  const mem = new Array(MEM_WORDS).fill(0xFFFF);
  for (let i = 0; i < game.memoryChanges.length; i++) {
    const { address, value } = game.memoryChanges[i];
    mem[(SEG << 4) + address] = value & 0xFFFF;
  }
  mem[0x0200] = 0xFFFF;                 // HALT: the far-call return
  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(mem);
  sim.d16nano = true;                  // the frame status and cycle counters
  Object.assign(sim.segmentRegisters, { CS: SEG, DS: SEG, SS: SEG, ES: 0 });
  sim.registers[10] = 0;
  sim.registers[11] = 0x0200;
  sim.registers[15] = 0;
  sim.running = true;
  return sim;
}

test('pole renders the HUD and quits on Esc', () => {
  const sim = boot();
  sim.kbdBuffer.push(0x10);             // Up
  sim.kbdBuffer.push(0x06);             // Right
  sim.kbdBuffer.push(0x1B);             // Esc
  // The game waits for the 0xF0066 frame toggle; drive it like the display
  // does. The board toggles every 112,500 cycles; the JS core counts
  // instructions, so any period longer than one simulated frame works.
  sim.tileStatus = 0;
  let steps = 0;
  while (sim.running && steps < 20_000_000) {
    sim.step();
    steps++;
    if (steps % 50000 === 0) sim.tileStatus ^= 2;
  }
  assert.equal(sim.running, false, 'the game returned to the caller');
  assert.ok(sim.memory[(SEG << 4) + G_SPEED] > 0, 'Up accelerated the car');

  const cell = (row, col) => sim.memory[0xF1000 + row * 82 + col] & 0xFFFF;
  assert.equal(cell(0, 0), 0x8000 | ((0x4C - 32) * 32), 'row 0 starts with LAP');
  assert.equal(cell(0, 1), 0x8000 | ((0x41 - 32) * 32), 'row 0 has A');
  assert.equal(cell(0, 2), 0x8000 | ((0x50 - 32) * 32), 'row 0 has P');
});
