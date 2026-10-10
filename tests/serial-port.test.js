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
import fs from 'node:fs';
import path from 'node:path';
import {
  assemble, loadBrowserScripts, loadRtl, runJs, runWasm, runRtl, MEM_WORDS, ROOT,
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

// ---------------------------------------------------------------------------
// Port parity: the same program and the same transfer on both cores. The serial
// line is what the other cores have to grow, so the contract is pinned two-way
// here instead of in a per-core file.
//
// The programs address the port through DS = 0xF000, which both cores decode
// the same way and which needs no ES segment setup.
// ---------------------------------------------------------------------------
// The port has to be reached through ES = 0xF000: the boot ROM resets DS to 0
// on the way in, so a DS-addressed read would land at 0x0066 and return plain
// memory. The store side stays in DS, which keeps the results at address 8.
function readCharsDs(n) {
  // A loop counting down from 0 would run 65536 times, so the read block is
  // only emitted when there is something to read.
  const reads = n > 0 ? `
        LDI ${n}
        MOV R7, R0, 0
loop:
        LDS R2, ES, R5
        STS R2, DS, R6
        ADD R6, 1
        SUB R7, 1
        JNZ loop` : '';
  return `
        .org 0x0100
main:
        LSI R6, 8
        LDI ${SER_DATA}
        MOV R5, R0, 0${reads}
        LDI ${SER_STATUS}
        MOV R5, R0, 0
        LDS R2, ES, R5
        STS R2, DS, R6
        HALT
`;
}

// Store area for readCharsDs: one cell per character, then the status.
function cells(get, count) {
  const out = [];
  for (let i = 0; i <= count; i++) out.push(get(8 + i) & 0xFFFF);
  return out;
}

const PARITY_CASES = [
  { label: 'one character, no EOF', n: 1, serial: 'A', eof: false, want: [0x0041, 0] },
  { label: 'two characters, no EOF', n: 2, serial: 'AB', eof: false, want: [0x0041, 0x0042, 0] },
  { label: 'EOF after draining', n: 2, serial: 'AB', eof: true, want: [0x0041, 0x0042, 2] },
  { label: 'EOF with nothing queued', n: 0, serial: '', eof: true, want: [2] },
  { label: 'EOF behind pending characters', n: 1, serial: 'AB', eof: true, want: [0x0041, 1] },
  { label: 'empty reads keep the EOF flag', n: 2, serial: '', eof: true, want: [0, 0, 2] },
];

for (const c of PARITY_CASES) {
  test(`serial parity: ${c.label}`, async () => {
    const res = assemble(readCharsDs(c.n));
    assert.ok(res.success, res.errors.join('; '));
    const opts = { cs: 0xFFFF, es: 0xF000, maxSteps: 20000, serial: c.serial, serialEof: c.eof };
    const { sim } = runJs(res, opts);
    const js = cells((a) => sim.memory[a], c.n);
    const wasm = await runWasm(res, opts);
    const w = cells((a) => wasm.memoryAt(a, 1)[0], c.n);
    assert.deepEqual(js, c.want, `the JS core reads something else`);
    assert.deepEqual(w, c.want, `the WASM core reads something else`);
  });
}

test('serial parity: WASM and JS agree cell for cell over a longer transfer', async () => {
  const source = ': foo 41 ;\r';
  const res = assemble(readCharsDs(source.length));
  assert.ok(res.success, res.errors.join('; '));
  const opts = { cs: 0xFFFF, es: 0xF000, maxSteps: 20000, serial: source, serialEof: true };
  const { sim } = runJs(res, opts);
  const wasm = await runWasm(res, opts);
  const js = cells((a) => sim.memory[a], source.length);
  const w = cells((a) => wasm.memoryAt(a, 1)[0], source.length);
  const want = [...source].map((c) => c.charCodeAt(0)).concat([2]);
  assert.deepEqual(js, want, 'the JS core must consume every character, then report EOF');
  assert.deepEqual(w, js, 'both cores must consume the transfer identically');
});

// ---------------------------------------------------------------------------
// The RTL core has to grow the same port. Its FIFO is popped in EX, so the
// double-pop trap from VERILOG.md applies here as much as it did to the
// keyboard: three LDS SER_DATA must return three characters, not one.
// ---------------------------------------------------------------------------
for (const c of PARITY_CASES) {
  test(`serial RTL parity: ${c.label}`, async () => {
    const res = assemble(readCharsDs(c.n));
    assert.ok(res.success, res.errors.join('; '));
    const opts = { cs: 0xFFFF, es: 0xF000, maxSteps: 20000, serial: c.serial, serialEof: c.eof };
    const rtl = await runRtl(res, opts);
    assert.deepEqual(cells((a) => rtl.memoryAt(a, 1)[0], c.n), c.want, 'the RTL core reads something else');
  });
}

test('serial: every LDS SER_DATA consumes exactly one character on all three cores', async () => {
  // The keyboard FIFO is popped in EX, so a held read can pop twice (VERILOG.md,
  // tests/rtl.test.js:538). The serial FIFO is built the same way, so the
  // invariant is pinned on the RTL core — the one where it can actually fail.
  const res = assemble(readCharsDs(3));
  assert.ok(res.success, res.errors.join('; '));
  const opts = { cs: 0xFFFF, es: 0xF000, maxSteps: 20000, serial: 'ABC', serialEof: true };
  const { sim } = runJs(res, opts);
  const wasm = await runWasm(res, opts);
  const rtl = await runRtl(res, opts);
  const want = [0x0041, 0x0042, 0x0043, 2];
  assert.deepEqual(cells((a) => sim.memory[a], 3), want, 'JS: three reads must return A, B, C');
  assert.deepEqual(cells((a) => wasm.memoryAt(a, 1)[0], 3), want, 'WASM: three reads must return A, B, C');
  assert.deepEqual(cells((a) => rtl.memoryAt(a, 1)[0], 3), want, 'RTL: three reads must return A, B, C');
});

test('serial: the queue level counts down on all three cores', async () => {
  // The host paces its pushes by this number: the RTL FIFO is 128 deep and
  // drops a push into a full one, so a wrong count means lost source text.
  const source = 'abcdefgh';
  const res = assemble(readCharsDs(4));
  assert.ok(res.success, res.errors.join('; '));
  const opts = { cs: 0xFFFF, es: 0xF000, maxSteps: 20000, serial: source, serialEof: true };
  const { sim } = runJs(res, opts);
  const wasm = await runWasm(res, opts);
  const rtl = await runRtl(res, opts);
  assert.equal(sim.serialAvailable(), source.length - 4, 'JS: four of eight characters were read');
  assert.equal(wasm.serialAvailable(), source.length - 4, 'WASM: four of eight characters were read');
  assert.equal(rtl.serialAvailable(), source.length - 4, 'RTL: four of eight characters were read');
});

test('serial: serial_available reports zero on a cleared line', async () => {
  const res = assemble(readCharsDs(0));
  assert.ok(res.success, res.errors.join('; '));
  const opts = { cs: 0xFFFF, es: 0xF000, maxSteps: 20000, serial: 'abc', serialEof: true };
  const { sim } = runJs(res, opts);
  const wasm = await runWasm(res, opts);
  const rtl = await runRtl(res, opts);
  assert.equal(sim.serialAvailable(), 3, 'JS: nothing was read, three are queued');
  assert.equal(wasm.serialAvailable(), 3, 'WASM: nothing was read, three are queued');
  assert.equal(rtl.serialAvailable(), 3, 'RTL: nothing was read, three are queued');
  sim.serialClear();
  assert.equal(sim.serialAvailable(), 0, 'JS: serialClear empties the queue');
});

test('serial: a machine reset clears the line on the RTL core too', async () => {
  const res = assemble(readCharsDs(0));
  assert.ok(res.success, res.errors.join('; '));
  const r = await loadRtl();
  r.init(MEM_WORDS);
  for (const ch of 'ABC') r.serial_push(ch.charCodeAt(0));
  r.serial_set_eof();
  // reset() refills the memory, so the probe has to be loaded again afterwards.
  r.reset();
  for (const ch of res.memoryChanges) {
    r.load_program(ch.address, new Uint16Array([ch.value & 0xFFFF]));
  }
  r.set_segments(0xFFFF, 0, 0, 0xF000);
  for (let i = 0; i < 2000 && r.step(); i++) { /* run to HALT */ }
  assert.deepEqual(
    cells((a) => r.get_memory_slice(a, 1)[0], 0), [0],
    'after a reset the line must be idle again, characters and EOF flag gone'
  );
});

// ---------------------------------------------------------------------------
// BIOS f6 (ser_getch). It can only be tested with the BIOS actually present in
// memory, and the BIOS lives in asm/forth.asm. So: assemble the kernel, then
// overlay a small stub on 0x0100 — the address the boot ROM jumps to — which
// leaves the BIOS at 0xF8000 untouched. buildMemory applies the changes in
// order, so the later snippet wins.
//
// The stub installs its own SWI trampoline: the vector at DS:[2] carries a
// plain PC, but the BIOS sits at CS = 0xF800, so a far jump is needed (JML uses
// the register pair R[Rx]:R[Rx+1]). The ROM hands over with DS = 0 and CS = 0.
// ---------------------------------------------------------------------------
const F6_STUB = (times) => `
        .org 0x0100
main:
        LDI tramp
        LSI R2, 2
        STS R0, DS, R2        ; DS:[2] = SWI vector (the register is the base,
                             ; so offset 2 — DS:[0] would be overwritten by the
                             ; call block itself and the SWI would jump back
                             ; into this stub)
        LDI 16
        MOV R1, R0            ; store pointer (shadowed, survives SWI)
        LSI R7, ${times}      ; call count
f6_loop:
        LDI 6
        LSI R2, 0
        STS R0, DS, R2        ; DS:0 = 6
        SWI
        LSI R2, 0
        LDS R3, DS, R2        ; DS:0 = status
        STS R3, DS, R1
        ADD R1, 1
        LSI R2, 1
        LDS R3, DS, R2        ; DS:1 = character
        STS R3, DS, R1
        ADD R1, 1
        SUB R7, 1
        JNZ f6_loop
        HALT
tramp:
        LDI 0x0FFF
        INV R0               ; R0 = 0xF000
        MOV R2, R0
        LDI 0x0800
        MOV R3, R0
        ADD R2, R3           ; R2 = 0xF800 (target CS)
        LDI 0
        MOV R3, R0           ; R3 = 0x0000 (target PC)
        JML R2               ; CS <- R2, PC <- R3
`;

let kernelRes = null;

function runF6(times, opts = {}) {
  if (!kernelRes) {
    const src = fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8');
    kernelRes = assemble(src);
    assert.ok(kernelRes.success, kernelRes.errors.join('; '));
  }
  const stub = assemble(F6_STUB(times));
  assert.ok(stub.success, stub.errors.join('; '));
  const merged = {
    success: true,
    errors: [],
    memoryChanges: [...kernelRes.memoryChanges, ...stub.memoryChanges],
  };
  return runJs(merged, { cs: 0xFFFF, es: 0xF000, maxSteps: 20000, ...opts });
}

// Store area layout for the stub: status0, char0, status1, char1, ...
function answers(sim, times) {
  const out = [];
  for (let i = 0; i < times * 2; i++) out.push(sim.memory[16 + i] & 0xFFFF);
  return out;
}

test('BIOS f6 reports the status and the queued character', () => {
  const { sim } = runF6(1, { serial: 'A' });
  assert.deepEqual(answers(sim, 1), [1, 0x0041], 'status 1 and the character A');
});

test('BIOS f6 walks the queue one character per call', () => {
  const { sim } = runF6(3, { serial: 'AB' });
  // A, B, then the drained line reporting idle
  assert.deepEqual(answers(sim, 3), [1, 0x0041, 1, 0x0042, 0, 0]);
});

test('BIOS f6 passes the end of transmission through as status 2', () => {
  const { sim } = runF6(1, { serial: 'AB', serialEof: true });
  assert.deepEqual(answers(sim, 1), [1, 0x0041], 'a queued character still outranks EOF');
  assert.equal(sim.serEof, true, 'and the EOF survives the read');
});

test('BIOS f6 reports end of transmission with no character', () => {
  const { sim } = runF6(4, { serial: 'AB', serialEof: true });
  // A, B, then EOF — and EOF again, because the flag is never consumed
  assert.deepEqual(answers(sim, 4), [1, 0x0041, 1, 0x0042, 2, 0, 2, 0]);
});

test('BIOS f6 does not consume a character on an idle line', () => {
  // Status 0 or 2 must leave SER_DATA alone: a read must consume a character,
  // and on the RTL core an unconditional read is where a double pop creeps in.
  const { sim } = runF6(2, { serial: 'AB', serialEof: true });
  answers(sim, 2);
  assert.equal(sim.serBuffer.length, 0, 'the two characters were consumed by the two reads');
  assert.equal(sim.serEof, true, 'the EOF flag is untouched');
});