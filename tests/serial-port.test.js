// The serial line that carries Forth source into the machine (SERPLAN.md).
//
// SER_STATUS (0xF0064) answers 0 = empty, 1 = a character is pending,
// 2 = end of transmission. SER_DATA (0xF0066) returns one character and
// consumes it.
//
// The tests drive the port from real instructions rather than from the host
// API, because the port contract is what the Forth kernel and the other two
// cores will depend on. Only the JS core has the port so far; the parity
// assertions against WASM and RTL arrive with those cores.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assemble, loadBrowserScripts, runJs,
} from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

// Addresses as the kernel will see them, with ES = 0xF000.
const SER_STATUS = 0x0064;
const SER_DATA = 0x0066;

// Read SER_STATUS once into memory[8].
const READ_STATUS = `
        .org 0x0100
main:
        LSI R6, 8
        LDI ${SER_STATUS}
        MOV R5, R0, 0
        LDS R2, ES, R5
        STS R2, DS, R6
        HALT
`;

// Read n characters from SER_DATA into memory[8..8+n-1], then read SER_STATUS
// into memory[8+n] — drain and observe in one pass on the same machine.
const readThenStatus = (n) => `
        .org 0x0100
main:
        LSI R6, 8
        LDI ${SER_DATA}
        MOV R5, R0, 0
        LDI ${n}
        MOV R7, R0, 0
loop:
        LDS R2, ES, R5
        STS R2, DS, R6
        ADD R6, 1
        SUB R7, 1
        JNZ loop
        LDI ${SER_STATUS}
        MOV R4, R0, 0
        LDS R2, ES, R4
        STS R2, DS, R6
        HALT
`;

test('serial: SER_STATUS answers 0 on an idle line', () => {
  const res = assemble(READ_STATUS);
  assert.ok(res.success, res.errors.join('; '));
  const { sim } = runJs(res, { cs: 0xFFFF, es: 0xF000, maxSteps: 5000 });
  assert.equal(sim.memory[8], 0, 'an untouched line must report nothing pending');
});

test('serial: SER_STATUS answers 1 while a character is pending', () => {
  const res = assemble(READ_STATUS);
  assert.ok(res.success, res.errors.join('; '));
  const { sim } = runJs(res, { cs: 0xFFFF, es: 0xF000, maxSteps: 5000, serial: ': foo' });
  assert.equal(sim.memory[8], 1, 'a queued character must show up as pending');
  assert.equal(sim.serBuffer.length, 5, 'reading the status must not consume anything');
});

test('serial: SER_DATA returns the queued characters in order', () => {
  const res = assemble(readThenStatus(5));
  assert.ok(res.success, res.errors.join('; '));
  const { sim } = runJs(res, { cs: 0xFFFF, es: 0xF000, maxSteps: 5000, serial: ': foo' });
  const text = String.fromCharCode(...[0, 1, 2, 3, 4].map((i) => sim.memory[8 + i] & 0xFF));
  assert.equal(text, ': foo');
  assert.equal(sim.serBuffer.length, 0, 'the queue is drained afterwards');
  assert.equal(sim.memory[13], 0, 'a drained line reports idle afterwards');
});

test('serial: every LDS SER_DATA consumes exactly one character', () => {
  // The keyboard FIFO is popped in the pipeline's EX stage, so a held read can
  // pop twice (VERILOG.md, tests/rtl.test.js). The same trap applies here, and
  // the RTL core is where it would bite — so the invariant is pinned now, on
  // the core that defines the reference behaviour.
  const res = assemble(readThenStatus(3));
  assert.ok(res.success, res.errors.join('; '));
  const chars = [0x0041, 0x0042, 0x0043];
  const { sim } = runJs(res, { cs: 0xFFFF, es: 0xF000, maxSteps: 5000, serial: 'ABC' });
  assert.deepEqual(
    [0, 1, 2].map((i) => sim.memory[8 + i] & 0xFFFF),
    chars,
    'three reads must return A, B, C — not A followed by empty reads'
  );
  assert.equal(sim.memory[11], 0, 'and nothing was left behind');
});

// SER_STATUS: 0 empty, 1 pending, 2 = end of transmission once drained.
test('serial: SER_STATUS falls back to 0 once the queue is drained', () => {
  const res = assemble(readThenStatus(2));
  assert.ok(res.success, res.errors.join('; '));
  const { sim } = runJs(res, { cs: 0xFFFF, es: 0xF000, maxSteps: 5000, serial: 'AB' });
  assert.equal(sim.memory[10], 0, 'a drained line must go back to idle');
});

test('serial: SER_STATUS answers 2 after the host signals end of transmission', () => {
  // READ_STATUS rather than readThenStatus(0): the read loop counts down and
  // never terminates for a count of 0.
  const res = assemble(READ_STATUS);
  assert.ok(res.success, res.errors.join('; '));
  const { sim } = runJs(res, { cs: 0xFFFF, es: 0xF000, maxSteps: 5000, serialEof: true });
  assert.equal(sim.memory[8], 2, 'EOF must be visible as its own status');
});

test('serial: end of transmission never hides queued characters', () => {
  // The machine has to read every character before it may see the EOF, so
  // STATUS stays 1 while anything is queued.
  const res = assemble(readThenStatus(2));
  assert.ok(res.success, res.errors.join('; '));
  const { sim } = runJs(res, {
    cs: 0xFFFF, es: 0xF000, maxSteps: 5000, serial: 'AB', serialEof: true,
  });
  assert.equal(sim.serBuffer.length, 0, 'the characters were consumed');
  assert.equal(sim.memory[10], 2, 'only after draining does EOF become visible');
  assert.equal(sim.serEof, true, 'the EOF flag itself is untouched by reading');

  const stillPending = runJs(assemble(READ_STATUS), {
    cs: 0xFFFF, es: 0xF000, maxSteps: 5000, serial: 'AB', serialEof: true,
  });
  assert.equal(stillPending.sim.memory[8], 1, 'a queued character outranks EOF');
});

test('serial: reading an empty queue returns 0 and keeps the EOF flag', () => {
  const res = assemble(readThenStatus(2));
  assert.ok(res.success, res.errors.join('; '));
  const { sim } = runJs(res, { cs: 0xFFFF, es: 0xF000, maxSteps: 5000, serialEof: true });
  assert.equal(sim.memory[8] & 0xFFFF, 0, 'a read with nothing queued yields 0');
  assert.equal(sim.memory[9] & 0xFFFF, 0, 'and again');
  assert.equal(sim.memory[10], 2, 'the EOF flag survived two empty reads');
});

test('serial: the port sits directly behind the keyboard ports', () => {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  assert.equal(sim.KBD_STATUS_ADDR, 0xF0060);
  assert.equal(sim.KBD_DATA_ADDR, 0xF0062);
  assert.equal(sim.SER_STATUS_ADDR, 0xF0064, 'must not collide with the keyboard');
  assert.equal(sim.SER_DATA_ADDR, 0xF0066);
});

test('serial: a machine reset clears the line', () => {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.serialPushString(': foo');
  sim.serialSetEof(true);
  sim.reset();
  assert.equal(sim.serBuffer.length, 0, 'a reset must not inherit a half-transferred source');
  assert.equal(sim.serEof, false, 'nor a stale end-of-transmission flag');
});

test('serial: serialClear drops queued characters and the EOF flag', () => {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.serialPushString(': foo');
  sim.serialSetEof(true);
  sim.serialClear();
  assert.equal(sim.serBuffer.length, 0);
  assert.equal(sim.serEof, false);
});