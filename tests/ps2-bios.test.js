// The PS/2 host init is BIOS code now (asm/forth_nano.asm, 0x5490).
//
// It is hard to reach from the normal REPL tests: the JS core has no PS/2
// model, so binit's 0xFFFF guard skips it. This file runs `ps2_init` directly
// in the segmented map and emulates the keyboard side of the wire: the host
// drives CLK/DATA through control 6 (0x200C), the keyboard clocks 11 bits and
// flips the receiver's frame toggle (0xF0066 bit 7) for every good frame. That
// is enough to pin the reset/enable order, the ACK/BAT waits and the
// no-keyboard timeout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, loadBrowserScripts, MEM_WORDS, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
                        { defines: { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1, D16D: 1 } });
const BIOS = 0x3000;
const DS = 0x1000;
const HALT = 0xBF0;                    // a free BIOS word, filled with 0xFFFF
const CTRL = 0xF200C;
const STATUS = 0xF0066;

function machine() {
  const mem = new Array(MEM_WORDS).fill(0xFFFF);
  for (const c of kernel.memoryChanges) if (c.address < 0x6000) mem[c.address] = c.value & 0xFFFF;
  for (let w = 0x3000; w <= 0x57dc; w++) mem[(DS << 4) + w] = mem[w];
  for (let w = 0x4a00; w <= 0x57ff; w++) mem[(BIOS << 4) + (w - 0x4a00)] = mem[w];
  mem[(BIOS << 4) + HALT] = 0xFFFF;     // JMP LR lands here and halts

  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(mem);
  sim.d16nano = true;
  sim.cycleCount = 0;
  sim.memory[STATUS] = 0x0060;          // CLK/DATA high, toggle 0
  sim.memory[CTRL] = 0;
  sim.segmentRegisters.CS = BIOS;
  sim.segmentRegisters.DS = DS;
  sim.segmentRegisters.SS = 0x2000;
  sim.segmentRegisters.ES = 0xF000;
  sim.registers[14] = HALT;
  sim.registers[15] = kernel.symbols.ps2_init - kernel.symbols.bios_entry;
  sim.psw = 0;
  sim.running = true;
  return sim;
}

// Runs ps2_init with a scripted keyboard. Returns the bytes the host sent and
// whether the routine returned. Phases are 12 steps: long enough for the
// sender's poll loops to see every edge.
function run({ keyboard = true, erased = false, ignore = 0, maxSteps = 30_000_000 } = {}) {
  const sim = machine();
  if (erased) sim.memory[STATUS] = 0xFFFF;
  let clk = 1, data = 1, toggle = 0;
  let state = 'idle', phase = 'low', bit = 0, wait = 0, ignored = 0;
  let bits = [], toggles = [], sent = [];
  const status = () => (clk ? 0x20 : 0) | (data ? 0x40 : 0) | (toggle ? 0x80 : 0);
  const schedule = (byte) => {
    // Reset answers ACK then BAT; every 0xF4 answers one ACK.
    toggles.push(steps + 200);
    if (byte === 0xFF) toggles.push(steps + 6000);
  };
  let steps = 0;
  for (; steps < maxSteps; steps++) {
    if (keyboard && !erased) {
      const ctrl = sim.memory[CTRL] & 0xFFFF;
      const ck = (ctrl >> 9) & 1, cd = (ctrl >> 10) & 1;
      if (state === 'idle') {
        if (ck === 1 && cd === 0) state = 'request';
      } else if (state === 'request') {
        if (ck === 0 && cd === 1) {
          if (ignored < ignore) { ignored++; state = 'ignoring'; }
          else { state = 'clocking'; phase = 'low'; bit = 0; bits = []; wait = 0; clk = 0; data = 1; }
        }
      } else if (state === 'ignoring') {
        if (ck === 0 && cd === 0) state = 'idle';   // the host gave up
      } else if (++wait >= 12) {
        wait = 0;
        if (phase === 'low') {
          // Data is stable through the low phase; sample at the rising edge.
          const now = (sim.memory[CTRL] >> 10) & 1;
          bits.push(now ? 0 : 1);
          if (bit === 11) {
            state = 'idle'; clk = 1; data = 1;
            const byte = bits.slice(1, 9).reduce((a, b, n) => a | (b << n), 0);
            const ones = bits.slice(1, 9).reduce((a, b) => a + b, 0);
            const good = bits[0] === 0 && bits[10] === 1 && ((ones + bits[9]) & 1) === 1;
            assert.ok(good, `keyboard saw a malformed host frame: ${bits.join('')}`);
            sent.push(byte);
            schedule(byte);
          } else { clk = 1; phase = 'high'; }
        } else { clk = 0; phase = 'low'; bit++; }
      }
      if (toggles.length && steps >= toggles[0]) { toggle ^= 1; toggles.shift(); }
      sim.memory[STATUS] = status();
    }
    sim.step();
    if ((sim.segmentRegisters.CS & 0xFFFF) === BIOS && (sim.registers[15] & 0xFFFF) === HALT) {
      return { sim, sent, steps, returned: true };
    }
  }
  return { sim, sent, steps, returned: false };
}

test('ps2_init sends reset, waits for ACK/BAT, then enables four times', () => {
  const r = run();
  assert.equal(r.returned, true, 'ps2_init returned');
  assert.deepEqual(r.sent, [0xFF, 0xF4, 0xF4, 0xF4, 0xF4]);
  assert.equal(r.sim.segmentRegisters.ES, 0xF000, 'ES back to the I/O segment');
});

test('ps2_init retries a reset the keyboard does not clock', () => {
  const r = run({ ignore: 2, maxSteps: 20_000_000 });
  assert.equal(r.returned, true, 'the third reset was accepted');
  assert.deepEqual(r.sent, [0xFF, 0xF4, 0xF4, 0xF4, 0xF4]);
});

test('ps2_init returns when the keyboard never clocks', () => {
  const r = run({ keyboard: false, maxSteps: 20_000_000 });
  assert.equal(r.returned, true, 'the sender timeouts let binit continue');
  assert.deepEqual(r.sent, [], 'nothing was clocked');
});

test('the erased-memory guard skips the init in the JS core', () => {
  const r = run({ erased: true, maxSteps: 10_000 });
  assert.equal(r.returned, true);
  assert.ok(r.steps < 1000, `guard returned in ${r.steps} steps`);
});
