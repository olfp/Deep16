#!/usr/bin/env node
// scripts/bench_pole_board.mjs - run the Pole timing harness on the board.
//
// asm/pole/pole_board.asm is the on-board harness: it renders N frames with
// the same renderer and the same state handling the core3 benchmark uses, and
// measures the cost with the board's own clocks (the 32-bit millisecond timer
// at 0xF0022/0xF0024 and the 16-bit cycle counter at 0xF0068). The result
// goes out over the UART and into the visible tilemap:
//
//   POLE frames=01024 ms=08300 cyc16=12345 cyc_per_frame=054693 core3=055862
//
// This script is the host side of that measurement:
//
//   node scripts/bench_pole_board.mjs                 # print the instructions
//   node scripts/bench_pole_board.mjs --port=/dev/ttyUSB0   # capture the UART
//   node scripts/bench_pole_board.mjs --sim           # dry run on the JS core
//
// The board number is directly comparable to the core3 baseline of 55,862
// cycles/frame: both run the same renderer and dirty skip, the core3 figure
// has no memory latency, so the board figure is expected to be the higher of
// the two.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPoleBench, checkPole } from './make_showcase.mjs';
import { buildSlices } from './make_slices.mjs';
import { assemblePoleBoard } from './pole_program.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The core3 baseline: scripts/bench_pole.mjs on the RTL core with
// combinational memory. The board number has to be read against this, so it
// moves whenever the renderer does.
export const CORE3_CYCLES = 55862;

// The 60 Hz budget at 6.75 MHz.
export const FRAME_BUDGET = 112500;

// The report the harness prints. The leading '!' marks a millisecond-counter
// wrap, so the delta is longer than 65.5 seconds. The millisecond and the
// cycles-per-frame fields are full decimal numbers (the board can be slower
// than the core3), the other fields are fixed width.
export const REPORT_RE =
  /^!?POLE frames=(\d{5}) ms=(\d+) cyc16=(\d{5}) cyc_per_frame=(\d+) core3=(\d{6})$/;

export function parseReport(line) {
  const match = REPORT_RE.exec(line.trim());
  if (!match) return null;
  return {
    wrapped: line.trim().startsWith('!'),
    frames: Number(match[1]),
    ms: Number(match[2]),
    cyc16: Number(match[3]),
    cpf: Number(match[4]),
    core3: Number(match[5]),
  };
}

// The slice the harness is published as, and the segment it loads into.
export function poleSliceInfo() {
  const pole = buildPoleBench();
  checkPole(pole);
  const { manifest } = buildSlices();
  return { pole, manifest, entry: manifest.objects.polebench };
}

// The instructions the user has to follow on the board.
function printInstructions(entry, pole) {
  console.log('Pole on-board benchmark');
  console.log('');
  console.log(`slice                   ${entry.first}..${entry.first + entry.count - 1}`
    + ` (${entry.words} words, segment 0x${pole.seg.toString(16)})`);
  console.log('');
  console.log('1. flash the slice image (the bitstream is not touched):');
  console.log('     npm run flash:slices');
  console.log('   or a full board update:');
  console.log('     npm run synth:tile && npm run flash:tile');
  console.log('2. power-cycle the board.');
  console.log('3. in the Forth console (PS/2 keyboard):');
  console.log('     s" games" need');
  console.log('     s" polebench" game-run');
  console.log('');
  console.log('polebench is the harness slice; pole is the playable game.');
  console.log('The harness renders the frames, prints the report line on the UART');
  console.log('and draws it into the top row of the screen. The console comes back');
  console.log('after the run.');
}

// Capture the UART until the report line shows up or the timeout expires.
export function captureUart(port, timeoutMs = 180000) {
  try {
    execFileSync('stty', ['-F', port, 'raw', '-echo', '115200'],
                 { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    throw new Error(`cannot set up ${port}: ${e.stderr?.toString() || e.message}`);
  }
  const fd = fs.openSync(port, fs.constants.O_RDWR | fs.constants.O_NOCTTY);
  const buffer = Buffer.alloc(4096);
  let text = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      let n = 0;
      try {
        n = fs.readSync(fd, buffer, 0, buffer.length, null);
      } catch (e) {
        // A non-blocking read with no data reports EAGAIN; keep waiting.
        if (e.code !== 'EAGAIN' && e.code !== 'EWOULDBLOCK') throw e;
      }
      if (n > 0) {
        text += buffer.toString('latin1', 0, n);
        const report = findReport(text);
        if (report) return report;
      } else {
        // Nothing yet: wait a little without spinning the CPU.
        execFileSync('sleep', ['0.05']);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  throw new Error(`no report line on ${port} within ${Math.round(timeoutMs / 1000)} s`);
}

// Pull the report line out of whatever the console printed.
export function findReport(text) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('POLE ') && !line.startsWith('!POLE ')) continue;
    const report = parseReport(line);
    if (report) return report;
  }
  return null;
}

// Compare the board number with the core3 baseline and the 60 Hz budget.
export function report(report) {
  console.log('');
  console.log(`frames                 ${report.frames}`);
  console.log(`milliseconds           ${report.ms}`);
  console.log(`cycle counter (mod 64k) ${report.cyc16}`);
  console.log(`board cycles/frame     ${report.cpf}`);
  console.log(`core3 cycles/frame     ${report.core3}`);
  const delta = report.cpf - report.core3;
  const percent = (report.cpf / report.core3) * 100;
  console.log(`difference             ${delta >= 0 ? '+' : ''}${delta} cycles`
    + ` (${percent.toFixed(1)}% of the core3 figure)`);
  const used = (report.cpf / FRAME_BUDGET) * 100;
  console.log(`60 Hz budget           ${FRAME_BUDGET} cycles/frame`);
  console.log(`budget used            ${used.toFixed(1)}%`);
  if (report.wrapped) {
    console.log('note                   the run was longer than 65.5 seconds');
  }
  if (report.cpf <= FRAME_BUDGET) {
    console.log('RESULT                 within the 60 Hz budget');
  } else {
    console.log('RESULT                 OVER the 60 Hz budget');
    process.exitCode = 1;
  }
  return report;
}

// The dry run: the same program on the JS core. The JS core counts one cycle
// per instruction, so its numbers are instruction counts, not board cycles.
async function dryRun() {
  const vm = await import('node:vm');
  globalThis.window = globalThis.window || {};
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/deep16_simulator.js'), 'utf8'),
                      { filename: 'js/deep16_simulator.js' });
  const Sim = vm.runInThisContext('Deep16Simulator');
  const res = assemblePoleBoard({ POLE_FAST: 1 });
  const SEG = 0x7000;
  const memory = new Array(1048576).fill(0xFFFF);
  for (const change of res.memoryChanges) {
    memory[(SEG << 4) + change.address] = change.value & 0xFFFF;
  }
  const sim = new Sim();
  sim.loadProgram(memory);
  sim.d16nano = true;
  sim.segmentRegisters.CS = SEG;
  sim.segmentRegisters.DS = SEG;
  sim.registers[10] = 0x0000;
  sim.registers[11] = 0x07F0;
  sim.registers[15] = 0x0000;
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 4000000) { sim.step(); steps++; }
  const line = Buffer.from(sim.uartTx).toString('latin1');
  console.log('');
  console.log(`JS core dry run        ${steps} instructions (the JS core counts one`
    + ' cycle per instruction, so this is not a board cycle count)');
  console.log(`report                 ${line.trim()}`);
}

function main() {
  const args = process.argv.slice(2);
  const port = args.find((a) => a.startsWith('--port='))?.slice(7);
  const timeout = Number(args.find((a) => a.startsWith('--timeout='))?.slice(10) || 180);
  const sim = args.includes('--sim');

  const { pole, entry } = poleSliceInfo();
  printInstructions(entry, pole);

  if (sim) {
    return dryRun();
  }
  if (!port) {
    console.log('');
    console.log('Pass --port=/dev/ttyUSB0 to capture the report from the board,');
    console.log('or --sim to dry-run the harness on the JS core.');
    return undefined;
  }
  console.log('');
  console.log(`capturing ${port} (up to ${timeout} s)...`);
  const reportLine = captureUart(port, timeout * 1000);
  report(reportLine);
  return reportLine;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
