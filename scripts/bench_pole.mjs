// scripts/bench_pole.mjs - measure the Pole road renderer on the D16nano core.
//
// The renderer is timed by difference: the same program is run twice, once
// with the renderer call compiled in and once without it. What is left is the
// renderer's own cost, which is what the 60 Hz budget has to cover.
//
//   node scripts/bench_pole.mjs [frames] [--binary <path>] [--keep]
//
// The run also checks the result: the harness dumps the map and the OAM the
// RTL core produced, and they have to match js/deep16_pole_model.js exactly.
//
// The core3 harness (rtl/sim/core3_pole_bench_tb.sv) has combinational
// memory, so these are the core's own cycles without any memory latency -
// the same caveat the other core3 figures in this repository carry.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assemblePole, poleImage } from './pole_program.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The host model is a plain browser script, so it is loaded the same way
// index.html pulls it in.
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/deep16_pole_model.js'), 'utf8'),
                    { filename: 'js/deep16_pole_model.js' });
const Model = globalThis.Deep16PoleModel;

export const FRAMES_CELL = 0x0520;     // the frame counter in the program image
const DEFAULT_BINARY = path.join(ROOT, 'obj_core3_pole_bench', 'core3_pole_bench');

// The frame budget: 60 Hz at 6.75 MHz is 112,500 cycles per frame.
export const FRAME_BUDGET = 112500;

function parseArgs(argv) {
  const options = { frames: 60, binary: DEFAULT_BINARY, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--binary') options.binary = path.resolve(argv[++i]);
    else if (arg === '--keep') options.keep = true;
    else if (!arg.startsWith('-')) options.frames = Number(arg);
    else throw new Error(`unknown option ${arg}`);
  }
  if (!Number.isInteger(options.frames) || options.frames < 1) {
    throw new Error(`the frame count must be a positive integer`);
  }
  return options;
}

// Build the program image for one run. render: call the renderer or not.
export function buildImage(render, frames) {
  const res = assemblePole(render ? { BENCH_RENDER: 1 } : {});
  const words = poleImage(res);
  words[FRAMES_CELL] = frames;
  return words;
}

// Write a $readmemh file: the used words only, in contiguous runs with an
// @address mark before each run. A word of 0xFFFF is the same as an unused
// word, so the runs may be split there without losing anything.
export function writeSparseMemFile(file, words) {
  const lines = [];
  let addr = 0;
  while (addr < words.length) {
    if (words[addr] === 0xFFFF) { addr++; continue; }
    lines.push(`@${addr.toString(16).toUpperCase().padStart(5, '0')}`);
    while (addr < words.length && words[addr] !== 0xFFFF) {
      lines.push(words[addr].toString(16).toUpperCase().padStart(4, '0'));
      addr++;
    }
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

// Run the harness and parse its "CYCLES n INSTR n HALT n" line.
export function runHarness(binary, imageFile, dumpFile = null) {
  const args = dumpFile ? [imageFile, dumpFile] : [imageFile];
  const output = execFileSync(binary, args, { encoding: 'utf8' });
  const match = output.match(/CYCLES\s+(\d+)\s+INSTR\s+(\d+)\s+HALT\s+(\d+)/);
  if (!match) throw new Error(`the harness printed no counters:\n${output}`);
  if (match[3] !== '1') throw new Error(`the program did not halt:\n${output}`);
  return { cycles: Number(match[1]), instructions: Number(match[2]) };
}

// The host model state that matches the benchmark driver: the same three
// opponents plus the four disabled slots the driver leaves at band 0xFFFF.
const BENCH_OPPONENTS = [
  { band: 5, lateral: -64, model: 0 },
  { band: 9, lateral: 96, model: 1 },
  { band: 13, lateral: 0, model: 2 },
];

export function modelState(frames) {
  const state = Model.defaultState('curve');
  state.opponents = BENCH_OPPONENTS.concat(
    Array.from({ length: 4 }, () => ({ band: 0xFFFF, lateral: 0, model: 0 })));
  for (let i = 0; i < frames; i++) Model.advance(state);
  return state;
}

// Check the map and the OAM the RTL core produced against the host model.
// The RTL and the JS simulator have to agree with the model, so this is the
// end-to-end proof that the benchmark measured the right program.
export function checkRender(dumpFile, frames) {
  const lines = fs.readFileSync(dumpFile, 'utf8').split('\n')
    .map((line) => line.trim()).filter((line) => line.length > 0);
  const header = lines.shift();
  if (header !== 'CELLS 1920 OAM 16') {
    throw new Error(`the dump file has an unexpected header: ${header}`);
  }
  const words = lines.map((line) => parseInt(line, 16) & 0xFFFF);
  if (words.length !== 1920 + 16) {
    throw new Error(`the dump file holds ${words.length} words, expected 1936`);
  }
  const expected = Model.render(modelState(frames));
  for (let row = 0; row < Model.ROWS; row++) {
    for (let col = 0; col < Model.COLS; col++) {
      const got = words[row * Model.COLS + col];
      const want = expected.cells[row * Model.COLS + col];
      if (got !== want) {
        throw new Error(`cell (${row}, ${col}) is 0x${got.toString(16)}, `
          + `the model says 0x${want.toString(16)}`);
      }
    }
  }
  for (let i = 0; i < 16; i++) {
    const got = words[1920 + i];
    if (got !== expected.oam[i]) {
      throw new Error(`OAM word ${i} is 0x${got.toString(16)}, `
        + `the model says 0x${expected.oam[i].toString(16)}`);
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.binary)) {
    throw new Error(
      `the core3 benchmark is not built: ${options.binary}\n`
      + 'run scripts/build_core3_pole_bench.sh first');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pole-bench-'));
  try {
    const withRender = path.join(tmp, 'with.hex');
    const withoutRender = path.join(tmp, 'without.hex');
    const dump = path.join(tmp, 'render.txt');
    writeSparseMemFile(withRender, buildImage(true, options.frames));
    writeSparseMemFile(withoutRender, buildImage(false, options.frames));

    const render = runHarness(options.binary, withRender, dump);
    const bare = runHarness(options.binary, withoutRender);

    // The RTL core has to produce the same map and OAM as the host model.
    checkRender(dump, options.frames);

    const rendererCycles = render.cycles - bare.cycles;
    const perFrame = rendererCycles / options.frames;
    const barePerFrame = bare.cycles / options.frames;

    console.log(`frames                 ${options.frames}`);
    console.log(`with the renderer      ${render.cycles} cycles `
      + `(${render.instructions} instructions)`);
    console.log(`without the renderer   ${bare.cycles} cycles `
      + `(${bare.instructions} instructions)`);
    console.log(`renderer per frame     ${perFrame.toFixed(0)} cycles`);
    console.log(`frame overhead         ${barePerFrame.toFixed(0)} cycles/frame`);
    console.log(`60 Hz budget           ${FRAME_BUDGET} cycles/frame`);
    const used = (perFrame / FRAME_BUDGET) * 100;
    console.log(`budget used            ${used.toFixed(1)}%`);
    console.log('map and OAM            match the host model');
    if (perFrame <= FRAME_BUDGET) {
      console.log('RESULT                 within the 60 Hz budget');
    } else {
      console.log('RESULT                 OVER the 60 Hz budget');
      process.exitCode = 1;
    }
  } finally {
    if (!options.keep) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Only run the benchmark when the script is called directly; a test may
// import the helpers above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
