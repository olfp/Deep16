// Milestone-2 checks for the D16 Pole road renderer.
//
// The renderer in asm/pole/pole_render.asm implements the geometry of
// js/deep16_pole_model.js exactly: the two must agree cell for cell and
// OAM word for OAM word, for every frame of a sequence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadBrowserScripts, ROOT } from './helpers.js';
import { assemblePole, poleSource } from '../scripts/pole_program.mjs';
import { buildImage, writeSparseMemFile } from '../scripts/bench_pole.mjs';

loadBrowserScripts('js/deep16_simulator.js', 'js/deep16_pole_model.js');

const Sim = globalThis.Deep16Simulator;
const Model = globalThis.Deep16PoleModel;

// The memory map the renderer and the bench share.
const TILE_BASE = 0xF1000;     // the FiT map window (82x26, two banks)
const MAP_COLS = 82;
const OAM_BASE = 0xF6000;      // the sprite descriptors
const CTRL_BASE = 0xF2000;     // the FiT control registers
const CTRL_MAP = 0xF2008;      // control 4: the write/display map bank

const CODE_START = 0x0100;
const CODE_END = 0x0A00;       // the tables start here
const ST_FRAMES = 0x0520;
const ST_BANK = 0x04B8;
const ST_PHASE = 0x04B0;

// The opponent records the benchmark driver writes: band, lateral, model.
const BENCH_OPPONENTS = [
  { band: 5, lateral: -64, model: 0 },
  { band: 9, lateral: 96, model: 1 },
  { band: 13, lateral: 0, model: 2 },
];

// The model state that matches the benchmark driver: the same three
// opponents plus the four disabled slots the driver leaves at band 0xFFFF.
function modelState(frames) {
  const state = Model.defaultState('curve');
  state.opponents = BENCH_OPPONENTS.concat(
    Array.from({ length: 4 }, () => ({ band: 0xFFFF, lateral: 0, model: 0 })));
  for (let i = 0; i < frames; i++) Model.advance(state);
  return state;
}

// Assemble the program with a given frame count and run it on the JS core.
function runFrames(frames, { defines = { BENCH_RENDER: 1 } } = {}) {
  const res = assemblePole(defines);
  assert.equal(res.success, true, res.errors.join('; '));
  const memory = new Array(1048576).fill(0xFFFF);
  for (const change of res.memoryChanges) {
    if (change.address === ST_FRAMES) continue;
    memory[change.address] = change.value & 0xFFFF;
  }
  memory[ST_FRAMES] = frames;
  const sim = new Sim();
  sim.loadProgram(memory);
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 2000000) { sim.step(); steps++; }
  assert.equal(sim.running, false, `the program did not halt (${steps} steps)`);
  // The program writes into the core's memory, not into the input image.
  return { sim, steps, memory: sim.memory };
}

// Compare the map and the OAM the assembly produced with the model's.
function assertParity(memory, frames) {
  const expected = Model.render(modelState(frames));
  let cellDiffs = 0;
  for (let row = 0; row < Model.ROWS; row++) {
    for (let col = 0; col < Model.COLS; col++) {
      const got = memory[TILE_BASE + row * MAP_COLS + col] & 0xFFFF;
      const want = expected.cells[row * Model.COLS + col];
      if (got !== want) {
        if (cellDiffs < 8) {
          assert.equal(got, want,
            `cell (${row}, ${col}) is 0x${got.toString(16)}, the model says 0x${want.toString(16)}`);
        }
        cellDiffs++;
      }
    }
  }
  assert.equal(cellDiffs, 0, `${cellDiffs} of ${Model.ROWS * Model.COLS} cells differ`);

  for (let i = 0; i < 16; i++) {
    const got = memory[OAM_BASE + i] & 0xFFFF;
    assert.equal(got, expected.oam[i],
      `OAM word ${i} is 0x${got.toString(16)}, the model says 0x${expected.oam[i].toString(16)}`);
  }

  // The bank control: bit 0 is the write bank, bit 1 the display bank.
  const control = memory[CTRL_BASE + 8] & 0xFFFF;
  const bank = frames & 1;
  assert.equal(control, (bank << 1) | bank,
    `the map control is 0x${control.toString(16)}, expected bank ${bank}`);
  assert.equal(memory[ST_BANK] & 0xFFFF, bank, 'the state must record the displayed bank');
  return expected;
}

test('the Pole program assembles with and without the renderer', () => {
  for (const defines of [{}, { BENCH_RENDER: 1 }]) {
    const res = assemblePole(defines);
    assert.equal(res.success, true, res.errors.join('; '));
    assert.ok(res.memoryChanges.length > 0);
  }
});

test('the renderer and the tables fit below the table block', () => {
  const res = assemblePole({ BENCH_RENDER: 1 });
  assert.equal(res.success, true, res.errors.join('; '));
  const words = new Map(res.memoryChanges.map((c) => [c.address, c.value & 0xFFFF]));

  // Nothing may be placed on top of the tables: the curve table starts at
  // 0x0A00 and the renderer code has to end before it.
  for (const [base, values] of [
    [0x0A00, Model.CURVE_TRACK],
    [0x0A40, Model.WIDTH_TRACK],
    [0x0A80, Model.HILL_OFFSETS],
    [0x0AA0, Model.SPRITE_W],
    [0x0AA4, Model.SPRITE_H],
    [0x0AA8, Model.SPRITE_GROUPS],
  ]) {
    values.forEach((value, i) => {
      assert.equal(words.get(base + i), value & 0xFFFF,
        `the table word at 0x${(base + i).toString(16)} is wrong`);
    });
  }
});

test('the frame path contains no divide instruction', () => {
  const res = assemblePole({ BENCH_RENDER: 1 });
  assert.equal(res.success, true, res.errors.join('; '));
  for (const change of res.memoryChanges) {
    if (change.address < CODE_START || change.address >= CODE_END) continue;
    const word = change.value & 0xFFFF;
    // DIV is 110 11110 Rd Rs, DIV32 is 110 11111 Rd Rs. The 110 prefix
    // matters: 1111111110 is the system group (NOP and friends).
    const isAlu = (word & 0xE000) === 0xC000;
    const func5 = (word >> 8) & 0x1F;
    assert.ok(!(isAlu && (func5 === 0x1E || func5 === 0x1F)),
      `a divide instruction at 0x${change.address.toString(16)}: 0x${word.toString(16)}`);
  }
});

test('the assembly map and OAM match the model exactly', () => {
  for (const frames of [1, 2, 5, 17, 60]) {
    const { memory } = runFrames(frames);
    assertParity(memory, frames);
  }
});

test('the renderer leaves the scroll margins alone', () => {
  const { memory } = runFrames(3);
  for (let row = 0; row < Model.ROWS; row++) {
    assert.equal(memory[TILE_BASE + row * MAP_COLS + Model.COLS] & 0xFFFF, 0xFFFF,
      'the extra map column must not be written');
    assert.equal(memory[TILE_BASE + row * MAP_COLS + Model.COLS + 1] & 0xFFFF, 0xFFFF,
      'the extra map column must not be written');
  }
  for (let col = 0; col < MAP_COLS; col++) {
    assert.equal(memory[TILE_BASE + Model.ROWS * MAP_COLS + col] & 0xFFFF, 0xFFFF,
      'the extra map row must not be written');
  }
});

test('the renderer is deterministic', () => {
  const first = runFrames(9).memory;
  const second = runFrames(9).memory;
  for (let i = 0; i < 24 * MAP_COLS; i++) {
    assert.equal(first[TILE_BASE + i] & 0xFFFF, second[TILE_BASE + i] & 0xFFFF,
      `the map differs at offset ${i}`);
  }
  for (let i = 0; i < 16; i++) {
    assert.equal(first[OAM_BASE + i] & 0xFFFF, second[OAM_BASE + i] & 0xFFFF,
      `the OAM differs at word ${i}`);
  }
});

test('the state advances the phase and the horizon the way the model does', () => {
  const { memory } = runFrames(4);
  const state = modelState(4);
  assert.equal(memory[ST_PHASE] & 0xFFFF, state.phase, 'the phase must advance by three per frame');
  assert.equal(memory[0x04B4] & 0xFFFF, state.horizonY & 0xFFFF,
    'the horizon must follow the hill table');
});

test('the checked-in tables match the model', () => {
  const source = fs.readFileSync(path.join(ROOT, 'asm/pole/pole_tables.asm'), 'utf8');
  const words = [];
  for (const match of source.matchAll(/\.word\s+([^\n]+)/g)) {
    for (const token of match[1].split(',')) {
      words.push(token.trim().startsWith('0x')
        ? parseInt(token.trim(), 16)
        : parseInt(token.trim(), 10));
    }
  }
  const expected = [
    ...Model.CURVE_TRACK, ...Model.WIDTH_TRACK, ...Model.HILL_OFFSETS,
    ...Model.SPRITE_W, ...Model.SPRITE_H, ...Model.SPRITE_GROUPS,
  ];
  assert.deepEqual(words, expected.map((v) => v & 0xFFFF),
    'asm/pole/pole_tables.asm is stale: run scripts/make_pole_tables.mjs');
});

test('the sources do not use a divide mnemonic', () => {
  const source = poleSource().toUpperCase();
  assert.ok(!/\bDIV32?\b/.test(source.replace(/;.*$/gm, '')),
    'the Pole assembly must not mention DIV or DIV32');
});

test('the benchmark image file round-trips into the same program', () => {
  // The core3 harness reads a $readmemh file, so the sparse writer has to
  // preserve every word of the program - including the words that happen to
  // be 0x0000. A dropped word turns into a halt and a wrong measurement.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pole-image-'));
  try {
    const file = path.join(tmp, 'image.hex');
    const image = buildImage(true, 3);
    writeSparseMemFile(file, image);

    // Read the file back the way the harness does.
    const memory = new Array(1048576).fill(0xFFFF);
    let addr = 0;
    for (const token of fs.readFileSync(file, 'utf8').split(/\s+/)) {
      if (!token) continue;
      if (token[0] === '@') { addr = parseInt(token.slice(1), 16); continue; }
      memory[addr++] = parseInt(token, 16) & 0xFFFF;
    }

    for (let i = 0; i < image.length; i++) {
      if (image[i] === 0xFFFF) continue;
      assert.equal(memory[i] & 0xFFFF, image[i],
        `the image word at 0x${i.toString(16)} did not survive the file`);
    }

    // And the restored image must still render the model's map.
    const sim = new Sim();
    sim.loadProgram(memory);
    sim.running = true;
    let steps = 0;
    while (sim.running && steps < 2000000) { sim.step(); steps++; }
    assert.equal(sim.running, false, `the restored image did not halt (${steps} steps)`);
    const expected = Model.render(modelState(3));
    for (let row = 0; row < Model.ROWS; row++) {
      for (let col = 0; col < Model.COLS; col++) {
        const got = sim.memory[TILE_BASE + row * MAP_COLS + col] & 0xFFFF;
        assert.equal(got, expected.cells[row * Model.COLS + col],
          `cell (${row}, ${col}) is 0x${got.toString(16)} after the image round-trip`);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
