// On-board harness checks for the D16 Pole road renderer.
//
// asm/pole/pole_board.asm is the timing harness that runs on the FPGA board:
// it renders POLE_FRAMES frames, measures the cost with the board's own
// millisecond timer and cycle counter, and prints the result over the UART
// and into the visible tilemap.
//
// These checks run the same program on the JS core, so they prove that the
// harness does the work it claims to do (the state advance and the renderer
// are the shared helpers), that its arithmetic is right, and that the report
// it prints is the one the board will print.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadBrowserScripts, ROOT } from './helpers.js';
import { assemblePole, assemblePoleBoard, poleBoardSource } from '../scripts/pole_program.mjs';

loadBrowserScripts('js/deep16_simulator.js', 'js/deep16_pole_model.js');

const Sim = globalThis.Deep16Simulator;
const Model = globalThis.Deep16PoleModel;

// The slice the board program is loaded into. 0x7000 is free in the D16D
// segment map (MEMMAP.md).
const SEG = 0x7000;
const BASE = SEG << 4;

// The core3 baseline the report quotes: 56,278 cycles/frame, measured by
// `node scripts/bench_pole.mjs 60` with the dirty skip on the RTL core with
// combinational memory. The renderer is re-measured whenever it changes, and
// the number here has to move with it.
const CORE3 = 56278;

const TILE_BASE = 0xF1000;
const OAM_BASE = 0xF6000;
const MAP_COLS = 82;

// The report row in the tilemap (asm/pole/pole_board.asm REPORT_ROW).
const REPORT_ROW = 1;

// The opponent records the shared state init writes.
const BENCH_OPPONENTS = [
  { band: 5, lateral: -64, model: 0 },
  { band: 9, lateral: 96, model: 1 },
  { band: 13, lateral: 0, model: 2 },
];

// Run the board program on the JS core. The JS core counts one cycle per
// instruction, so its numbers are the instruction counts, not the board's
// cycles - the arithmetic is the same either way.
// timer: an optional replacement for the simulator's millisecond timer, so a
// test can place the timer near its wrap or stretch the run.
function runBoard(defines = { POLE_FAST: 1 }, timer = null) {
  const res = assemblePoleBoard(defines);
  assert.equal(res.success, true, res.errors.join('; '));
  const memory = new Array(1048576).fill(0xFFFF);
  for (const change of res.memoryChanges) {
    memory[BASE + change.address] = change.value & 0xFFFF;
  }
  const sim = new Sim();
  sim.loadProgram(memory);
  sim.d16nano = true;                 // the timer and the cycle counter
  if (timer) sim.msTimer = timer;
  sim.segmentRegisters.CS = SEG;
  sim.segmentRegisters.DS = SEG;
  // The far return pair: segment 0, a PC that holds a HALT word.
  sim.registers[10] = 0x0000;
  sim.registers[11] = 0x07F0;
  sim.registers[15] = 0x0000;
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 4000000) { sim.step(); steps++; }
  assert.equal(sim.running, false, `the board program did not halt (${steps} steps)`);
  const line = Buffer.from(sim.uartTx).toString('latin1');
  return { sim, steps, line, res };
}

// The model state that matches the shared state init.
function modelState(frames) {
  const state = Model.defaultState('curve');
  state.opponents = BENCH_OPPONENTS.concat(
    Array.from({ length: 4 }, () => ({ band: 0xFFFF, lateral: 0, model: 0 })));
  for (let i = 0; i < frames; i++) Model.advance(state);
  return state;
}

// Pull the fields out of the report line.
function parseReport(line) {
  const match = line.match(
    /^!?POLE frames=(\d{5}) ms=(\d+) cyc16=(\d{5}) cyc_per_frame=(\d+) core3=(\d{6})\n$/);
  assert.ok(match, `the report line is malformed: ${JSON.stringify(line)}`);
  return {
    wrapped: line.startsWith('!'),
    frames: Number(match[1]),
    ms: Number(match[2]),
    cyc16: Number(match[3]),
    cpf: Number(match[4]),
    core3: Number(match[5]),
  };
}

test('the board program assembles and fits the slice', () => {
  for (const defines of [{}, { POLE_FAST: 1 }]) {
    const res = assemblePoleBoard(defines);
    assert.equal(res.success, true, res.errors.join('; '));
    const max = Math.max(...res.memoryChanges.map((c) => c.address));
    // The code, the tables and the dirty helper fit below the art copy at
    // 0x0C00, and the art blocks start at 0x1000.
    assert.ok(max < 0x1000,
      `the board program reaches 0x${max.toString(16)}, into the art`);
    // The entry is at offset 0 and the renderer is where the other drivers
    // expect it.
    assert.equal(res.symbols.pole_start, 0);
    assert.equal(res.symbols.pole_render, 0x01A0);
  }
});

test('the board program does not divide', () => {
  const source = poleBoardSource().toUpperCase();
  assert.ok(!/\bDIV32?\b/.test(source.replace(/;.*$/gm, '')),
    'the Pole assembly must not mention DIV or DIV32');
});

test('the board program prints the report and stops', () => {
  const { line, steps } = runBoard({ POLE_FAST: 1 });
  const report = parseReport(line);
  assert.equal(report.frames, 64, 'the fast build renders 64 frames');
  assert.equal(report.core3, CORE3, 'the report quotes the core3 baseline');
  assert.ok(report.ms > 0, 'the millisecond timer has to advance');
  assert.ok(steps > 100000, 'the harness really ran the renderer');
});

test('the reported cycles per frame are the timer delta times 6750', () => {
  const { line } = runBoard({ POLE_FAST: 1 });
  const report = parseReport(line);
  // 6750 cycles to a millisecond at 6.75 MHz, spread over the frames.
  assert.equal(report.cpf, Math.floor((report.ms * 6750) / report.frames),
    'the cycles per frame do not follow from the millisecond delta');
});

test('a timer that wraps during the run still gives the right delta', () => {
  // The timer reads its low half and then its high half, so the mock hands
  // out the same value for the pair. The first pair is just below the wrap,
  // the second just after it, so the delta crosses the wrap.
  let reads = 0;
  const timer = () => (reads++ < 2 ? 0xFFFF0000 : 0x00000100);
  const { line } = runBoard({ POLE_FAST: 1 }, timer);
  const report = parseReport(line);
  // The delta is 0x00000100 - 0xFFFF0000 = 0x00010100 = 65792 ms, and the
  // high half of the delta is 1, so the line carries the wrap marker.
  assert.equal(report.ms, 65792, 'the millisecond delta crosses the wrap');
  assert.equal(report.wrapped, true, 'the line is marked');
  assert.equal(report.cpf, Math.floor((report.ms * 6750) / report.frames),
    'the cycles per frame do not follow from the millisecond delta');
});

test('a board slower than 65535 cycles per frame still prints its number', () => {
  // The board has real PSRAM, so it is slower than the core3 with its
  // combinational memory. The printer has to carry a value above 65535.
  let reads = 0;
  const timer = () => (reads++ < 2 ? 0x00000000 : 0x000002BC);
  const { line } = runBoard({ POLE_FAST: 1 }, timer);
  const report = parseReport(line);
  // 700 ms over 64 frames: 73828 cycles per frame, which is above 65535.
  assert.equal(report.ms, 700, 'the millisecond delta');
  assert.equal(report.cpf, Math.floor((700 * 6750) / 64), 'the cycles per frame');
  assert.ok(report.cpf > 65535, 'this case is above one register');
});

test('a run longer than 65.5 seconds still prints its number', () => {
  // The high half of the millisecond delta is not zero here, so the cycles
  // per frame come from both halves of the delta.
  let reads = 0;
  const timer = () => (reads++ < 2 ? 0xFFFF0000 : 0x00010000);
  const { line } = runBoard({ POLE_FAST: 1 }, timer);
  const report = parseReport(line);
  // The delta is 0x00010000 - 0xFFFF0000 = 0x00020000 = 131072 ms, so the
  // high half is 2 and the cycles per frame are well above 65535.
  assert.equal(report.ms, 131072, 'the millisecond delta');
  assert.equal(report.cpf, Math.floor((131072 * 6750) / 64),
    'the cycles per frame do not follow from the millisecond delta');
  assert.equal(report.cpf, 13824000, 'the cycles per frame');
});

test('the cycle counter agrees with the millisecond timer', () => {
  const { line } = runBoard({ POLE_FAST: 1 });
  const report = parseReport(line);
  // The timer truncates, so the cycle count and the timer may differ by up
  // to one millisecond. The cycle counter is 16 bits, so the comparison is
  // done modulo 65536.
  const expected = (report.ms * 6750) & 0xFFFF;
  let delta = (report.cyc16 - expected) & 0xFFFF;
  if (delta > 32767) delta -= 65536;
  assert.ok(Math.abs(delta) <= 6750,
    `the cycle counter is ${delta} cycles away from the timer`);
});

test('the harness renders the same picture as the host model', () => {
  const frames = 64;
  const { sim } = runBoard({ POLE_FAST: 1 });
  const expected = Model.render(modelState(frames));
  let diffs = 0;
  for (let row = 0; row < Model.ROWS; row++) {
    for (let col = 0; col < Model.COLS; col++) {
      if (row === REPORT_ROW) continue;          // the report row is the text
      const got = sim.memory[TILE_BASE + row * MAP_COLS + col] & 0xFFFF;
      const want = expected.cells[row * Model.COLS + col];
      if (got !== want) {
        if (diffs < 5) {
          assert.equal(got, want,
            `cell (${row}, ${col}) is 0x${got.toString(16)}, the model says 0x${want.toString(16)}`);
        }
        diffs++;
      }
    }
  }
  assert.equal(diffs, 0, `${diffs} of ${Model.ROWS * Model.COLS} cells differ`);
  for (let i = 0; i < 16; i++) {
    const got = sim.memory[OAM_BASE + i] & 0xFFFF;
    assert.equal(got, expected.oam[i], `OAM word ${i} differs`);
  }
});

test('the report is drawn into the visible tilemap as well', () => {
  const { sim, line } = runBoard({ POLE_FAST: 1 });
  let screen = '';
  for (let col = 0; col < 82; col++) {
    const word = sim.memory[TILE_BASE + REPORT_ROW * MAP_COLS + col] & 0xFFFF;
    if (!(word & 0x8000)) break;
    screen += String.fromCharCode(0x20 + ((word >> 5) & 0x7F));
  }
  assert.equal(screen, line.replace(/\n$/, ''),
    'the screen and the UART have to show the same report');
});

test('the board harness and the core3 benchmark share the state handling', () => {
  // The bench driver and the board driver have to leave the same state
  // behind, or the board would not be measuring the same work.
  const frames = 64;
  const bench = assemblePole({ BENCH_RENDER: 1 });
  const benchMemory = new Array(1048576).fill(0xFFFF);
  for (const change of bench.memoryChanges) {
    if (change.address === 0x0520) continue;
    benchMemory[change.address] = change.value & 0xFFFF;
  }
  benchMemory[0x0520] = frames;
  const benchSim = new Sim();
  benchSim.loadProgram(benchMemory);
  benchSim.running = true;
  let steps = 0;
  while (benchSim.running && steps < 2000000) { benchSim.step(); steps++; }
  assert.equal(benchSim.running, false, 'the benchmark did not halt');

  const board = assemblePoleBoard({ POLE_FAST: 1 });
  const boardMemory = new Array(1048576).fill(0xFFFF);
  for (const change of board.memoryChanges) {
    boardMemory[BASE + change.address] = change.value & 0xFFFF;
  }
  const boardSim = new Sim();
  boardSim.loadProgram(boardMemory);
  boardSim.d16nano = true;
  boardSim.segmentRegisters.CS = SEG;
  boardSim.segmentRegisters.DS = SEG;
  boardSim.registers[10] = 0x0000;
  boardSim.registers[11] = 0x07F0;
  boardSim.registers[15] = 0x0000;
  boardSim.running = true;
  steps = 0;
  while (boardSim.running && steps < 4000000) { boardSim.step(); steps++; }

  for (const [name, addr] of [['the phase', 0x04B0], ['the hill phase', 0x04B2],
                              ['the horizon', 0x04B4], ['the player', 0x04B6]]) {
    const want = benchSim.memory[addr] & 0xFFFF;
    const got = boardSim.memory[BASE + addr] & 0xFFFF;
    assert.equal(got, want, `${name} differs between the two drivers`);
  }
  // The state init and the advance are the same code in both programs.
  assert.equal(board.symbols.pole_state_init, bench.symbols.pole_state_init);
  assert.equal(board.symbols.pole_state_advance, bench.symbols.pole_state_advance);
});

test('the board sources carry no divide and no scratch outside the map', () => {
  // The report helpers live above the tables, and nothing may land in the
  // renderer's scratch cells or the band descriptors.
  const res = assemblePoleBoard();
  for (const change of res.memoryChanges) {
    const a = change.address;
    assert.ok(!(a >= 0x04DC && a < 0x0520),
      `the board program writes into the renderer's scratch at 0x${a.toString(16)}`);
  }
  // The source is in the tree, so a stale copy cannot slip in.
  assert.ok(fs.existsSync(path.join(ROOT, 'asm/pole/pole_board.asm')));
});
