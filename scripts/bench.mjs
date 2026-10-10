#!/usr/bin/env node
// Benchmark: JS-Core vs WASM-Core vs RTL-Core auf typischem Befehlsmix.
//
//   node scripts/bench.mjs               # Standard: 20 Mio. Schritte je Messung
//   node scripts/bench.mjs 100000000     # mehr Schritte (stabiler, laenger)
//
// Das Testprogramm liegt in scripts/bench.asm (Endlosschleife, typische
// Mischung aus ALU, Speichern, Schieben und Spruengen). Ein step()-Aufruf
// fuehrt genau eine Instruktion aus (Delay Slots zaehlen mit), deshalb ist
//   MIPS = Schritte / Zeit / 1e6
// Die Endzustaende aller Messvarianten werden miteinander verglichen -
// eine schnellere Ausfuehrung waere wertlos, wenn sie anders rechnet.
//
// Varianten:
//   JS, dichte Schleife         wie der JS-Kern intern gefahren wird
//   WASM, pro Schritt           jeder step() ueberschreitet die JS/WASM-Grenze
//                               (so faehrt die IDE die Box)
//   WASM, run_steps(n)          ganzer Block in einem Aufruf - reine
//                               Kerngeschwindigkeit ohne Grenzkosten
//   RTL, pro Schritt            derselbe Weg, aber ein Schritt ist beim
//                               Pipeline-Kern ein *retirierter* Befehl: er
//                               laeuft intern so viele Takte, bis einer fertig
//   RTL, run_steps(n)           Blockbetrieb, ohne Grenzkosten pro Schritt

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  assemble, loadBrowserScripts, buildMemory, loadWasm, loadRtl, ROOT, MEM_WORDS,
} from '../tests/helpers.js';

const RUNS = 3;
const STEPS = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 20_000_000;
const WARMUP = Math.min(STEPS, 2_000_000);

// Realer 6502 bei 1 MHz: 0.43 MIPS (typischer Mix, 2.3 Zyklen/Befehl;
// Quelle: gängige MIPS-Vergleichstabelle, Wikipedia "Instructions per
// second"). Das absolute Maximum waeren 0.5 MIPS - keine 6502-Instruktion
// laeuft in einem einzigen Takt.
const MIPS_6502_1MHZ = 0.43;

// ---------------------------------------------------------------- Programm
const src = fs.readFileSync(path.join(ROOT, 'scripts', 'bench.asm'), 'utf8');
loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');
const prog = assemble(src);
if (!prog.success) {
  console.error('bench.asm assembliert nicht:\n  ' + prog.errors.join('\n  '));
  process.exit(1);
}

// ---------------------------------------------------------------- JS-Core
function freshJs() {
  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(buildMemory(prog));
  sim.segmentRegisters.CS = 0xFFFF;
  sim.segmentRegisters.DS = 0x0000;
  sim.segmentRegisters.SS = 0x0000;
  sim.segmentRegisters.ES = 0x0000;
  sim.running = true;
  return sim;
}

function runJs(steps) {
  const sim = freshJs();
  let n = 0;
  const t0 = performance.now();
  for (; n < steps; n++) { if (!sim.step()) break; }
  return { ms: performance.now() - t0, n, sim };
}

// -------------------------------------------------------------- WASM-Core
const wasm = await loadWasm();

function freshWasm() {
  wasm.init(MEM_WORDS);
  for (const ch of prog.memoryChanges) {
    wasm.load_program(ch.address, new Uint16Array([ch.value & 0xFFFF]));
  }
  wasm.set_segments(0xFFFF, 0x0000, 0x0000, 0x0000);
}

function runWasmStep(steps) {
  freshWasm();
  let n = 0;
  const t0 = performance.now();
  for (; n < steps; n++) { if (!wasm.step()) break; }
  return { ms: performance.now() - t0, n };
}

function runWasmBatch(steps) {
  freshWasm();
  const t0 = performance.now();
  const cont = wasm.run_steps(steps);
  const ms = performance.now() - t0;
  return { ms, n: steps, halted: !cont };
}

// --------------------------------------------------------------- RTL-Core
// Gleiches Programm, gleiche Schrittzahl, gleicher Massstab: ein Schritt ist
// ein retired Befehl. Der Pipeline-Kern braucht dafuer intern ~1,2-2 Taktlagen
// und Verilator wertet pro Takt die gesamte Pipeline neu aus - beides ist der
// Preis fuer den echten RTL-Kern und gehoert in diese Zahl, nicht drumherum.
const rtl = await loadRtl();

function freshRtl() {
  rtl.init(MEM_WORDS);
  for (const ch of prog.memoryChanges) {
    rtl.load_program(ch.address, new Uint16Array([ch.value & 0xFFFF]));
  }
  rtl.set_segments(0xFFFF, 0x0000, 0x0000, 0x0000);
}

function runRtlStep(steps) {
  freshRtl();
  let n = 0;
  const t0 = performance.now();
  for (; n < steps; n++) { if (!rtl.step()) break; }
  return { ms: performance.now() - t0, n };
}

function runRtlBatch(steps) {
  freshRtl();
  const t0 = performance.now();
  const cont = rtl.run_steps(steps);
  const ms = performance.now() - t0;
  return { ms, n: steps, halted: !cont };
}

// ---------------------------------------------------------------- Messung
function measure(fn, label) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(fn(STEPS));
  for (const r of runs) {
    if (r.n !== STEPS) {
      console.error(`${label}: Programm endete nach ${r.n} statt ${STEPS} Schritten`);
      process.exit(1);
    }
  }
  const best = runs.reduce((a, b) => (a.ms < b.ms ? a : b));
  const mean = runs.reduce((a, b) => a + b.ms, 0) / runs.length;
  return { label, best, mean, mips: STEPS / (best.ms / 1000) / 1e6 };
}

// Warmup: V8 JIT und WASM-Aufrufpfade sollen vor den Messlaeufen heiss sein.
runJs(WARMUP);
runWasmStep(WARMUP);
runWasmBatch(WARMUP);
runRtlStep(WARMUP);
runRtlBatch(WARMUP);

const results = [
  measure(runJs, 'JS, dichte Schleife'),
  measure(runWasmStep, 'WASM, pro Schritt (IDE-Weg)'),
  measure(runWasmBatch, 'WASM, run_steps (Batch)'),
  measure(runRtlStep, 'RTL, pro Schritt (IDE-Weg)'),
  measure(runRtlBatch, 'RTL, run_steps (Batch)'),
];
const jsMips = results[0].mips;

// ------------------------------------------------------- Endzustand-Vergleich
function stateJs(sim) {
  return {
    regs: Array.from(sim.registers),
    psw: sim.psw & 0xFFFF,
    segs: [sim.segmentRegisters.CS, sim.segmentRegisters.DS,
           sim.segmentRegisters.SS, sim.segmentRegisters.ES],
  };
}
function stateWasm() {
  return {
    regs: Array.from(wasm.get_registers()),
    psw: wasm.get_psw() & 0xFFFF,
    segs: Array.from(wasm.get_segments()),
  };
}
function stateRtl() {
  return {
    regs: Array.from(rtl.get_registers()),
    psw: rtl.get_psw() & 0xFFFF,
    segs: Array.from(rtl.get_segments()),
  };
}

// Frische Laeufe mit identischer Schrittzahl fuer den Zustandsvergleich.
const jsEnd = stateJs(runJs(STEPS).sim);
runWasmStep(STEPS);
const wasmStepEnd = stateWasm();
runWasmBatch(STEPS);
const wasmBatchEnd = stateWasm();
runRtlStep(STEPS);
const rtlStepEnd = stateRtl();
runRtlBatch(STEPS);
const rtlBatchEnd = stateRtl();

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Register und Segmente muessen identisch sein - sonst rechnen die Kerne
// unterschiedlich und die Geschwindigkeitszahlen waeren wertlos.
// PSW-Differenzen werden getrennt gemeldet: bei identischen Registern waere
// der Befehlsfluss zwar gleich, eine Flag-Abweichung waere aber ein Bug in
// der Flag-Logik eines der Kerne (Spec: Deep16-Arch.md, Tests: flags.test.js).
const ENDS = { wasmStep: wasmStepEnd, wasmBatch: wasmBatchEnd,
               rtlStep: rtlStepEnd, rtlBatch: rtlBatchEnd };
const regsOk = Object.values(ENDS).every((e) => same(jsEnd.regs, e.regs));
const segsOk = Object.values(ENDS).every((e) => same(jsEnd.segs, e.segs));
const pswOk = Object.values(ENDS).every((e) => jsEnd.psw === e.psw);
const FLAG = { 1: 'N', 2: 'Z', 4: 'V', 8: 'C' };
const pswDiff = [];
if (!pswOk) {
  const bits = jsEnd.psw ^ wasmStepEnd.psw;
  for (const [m, name] of Object.entries(FLAG)) {
    if (bits & Number(m)) pswDiff.push(`${name} (js:${(jsEnd.psw & m) ? 1 : 0} wasm:${(wasmStepEnd.psw & m) ? 1 : 0})`);
  }
}

// ------------------------------------------------------------------ Ausgabe
const fmt = (x, d = 1) => x.toFixed(d).padStart(8);
console.log(`Programm:   scripts/bench.asm (Endlosschleife, typischer Befehlsmix)`);
console.log(`Schritte:   ${STEPS.toLocaleString('de-DE')} je Messung, beste von ${RUNS} Laeufen`);
console.log('');
console.log('Kern                             Zeit best   Zeit Mittel      MIPS   zu JS');
console.log('-------------------------------------------------------------------------');
for (const r of results) {
  console.log(
    `${r.label.padEnd(32)} ${fmt(r.best.ms / 1000, 3)} s   ${fmt(r.mean / 1000, 3)} s` +
    `${fmt(r.mips)}   ${(r.mips / jsMips).toFixed(2).padStart(5)}x`);
}
console.log('');
if (regsOk && segsOk) {
  console.log(`Register und Segmente aller ${results.length} Varianten nach ${STEPS.toLocaleString('de-DE')} Schritten: identisch`);
  if (pswOk) {
    console.log('PSW identisch.');
  } else {
    console.log(`PSW-Differenz auf Bit ${pswDiff.join(', ')} - Flag-Logik weicht ab!`);
    console.log('  Register und Segmente sind identisch, der Befehlsfluss lief in beiden');
    console.log('  Kernen also gleich und die Messung ist gueltig - die Abweichung selbst');
    console.log('  ist aber ein Bug (Spec: Deep16-Arch.md, Tests: tests/flags.test.js).');
  }
} else {
  console.log('ABWEICHUNG IM REGISTERZUSTAND - die Kerne rechnen unterschiedlich!');
  for (const [name, e] of Object.entries(ENDS)) {
    console.log(`  JS vs ${name}: regs ${same(jsEnd.regs, e.regs)}, segs ${same(jsEnd.segs, e.segs)}`);
  }
  process.exit(1);
}
console.log('');
console.log(`Zum Vergleich, realer 6502 bei 1 MHz: ${MIPS_6502_1MHZ} MIPS (typischer Mix)`);
for (const r of results) {
  console.log(`  ${r.label.padEnd(32)} ${(r.mips / MIPS_6502_1MHZ).toFixed(0).padStart(6)}x schneller`);
}
