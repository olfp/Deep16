// The boot script: forth/demo.fth, baked into the image and read by read_line
// before the keyboard on every boot (D16MINI.md §7).
//
// These run on the JS core only. The script costs ~1M steps to compile, and the
// three-core console parity tests deliberately boot with it switched off; what
// the script defines (`free`, `mem`, `demo`) and the bytes it prints are pinned
// here instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assemble, buildMemory, loadBrowserScripts, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8'),
                        { defines: { CONSOLE_UART: 1 } });
const sym = kernel.symbols;
// The ceiling is a kernel cell now: the boot probe raises it when the machine
// has memory past the 24K window (the JS core has the full 1 MB).
const limit = () => sim.memory[sym.dict_limit_var];

const sim = new globalThis.Deep16Simulator();
sim.loadProgram(buildMemory(kernel));
sim.segmentRegisters.CS = 0xFFFF;
sim.running = true;

function pump(steps, stream) {
  for (let i = 0; i < steps && sim.running; i++) {
    sim.step();
    if (sim.uartTx.length) stream.push(...sim.uartTxTake());
  }
  return stream;
}

// Boot and hand back everything the REPL printed.
const bootStream = pump(1400000, []);
const bootText = Buffer.from(bootStream).toString('latin1');

// Type a line and collect the bytes it produces, up to the next prompt.
function run(line, steps = 200000, preKey = null) {
  const stream = [];
  for (const ch of `${line}\n`) sim.uartRxPush(ch === '\n' ? 13 : ch.charCodeAt(0));
  pump(steps, stream);
  if (preKey !== null) {
    sim.uartRxPush(preKey);
    pump(steps, stream);
  }
  return Buffer.from(stream).toString('latin1');
}

const here = () => sim.memory[sym.dp_var];

test('the boot script compiles at boot and prints the summary', () => {
  assert.match(bootText, /Hello DeepForth!/);
  const line = bootText.split('\r\n').find((l) => l.startsWith('Deep16') || l.startsWith('D16MINI'));
  assert.ok(line, `no summary line in ${JSON.stringify(bootText.slice(0, 200))}`);
  const free = Number((line.match(/,\s*(\d+) free/) || [])[1]);
  assert.equal(free, limit() - here(), 'the summary free count is here-based');
  assert.ok(free > 1000, `only ${free} words free - the script grew too far`);
});

test('free is the dictionary headroom, and unused agrees with it', () => {
  const out = run('free u. unused u.');
  const nums = [...out.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(nums.length >= 2, `expected two numbers: ${JSON.stringify(out)}`);
  assert.equal(nums[0], limit() - here());
  assert.equal(nums[1], nums[0], 'unused and free must report the same ceiling');
});

test('mem prints the map', () => {
  const out = run('mem');
  for (const needle of ['Deep16 memory map', '00000-FFFFF', 'UART F0040', 'FFFF0']) {
    assert.ok(out.includes(needle), `mem does not mention ${needle}: ${JSON.stringify(out)}`);
  }
  // The dictionary line carries the range and the free count.
  assert.match(out, /dict\s+[0-9A-F]+ -[0-9A-F]+\s+\d+ words, \d+ free/,
               `no dictionary line: ${JSON.stringify(out)}`);
});

test('key? polls the console without consuming the byte', () => {
  const idle = run('key? .');
  assert.match(idle, /key\? \. 0 {2}ok/, `key? with nothing waiting: ${JSON.stringify(idle)}`);
  // Push a byte after the line's CR: getstr has stopped reading, so it is still
  // queued while the line is interpreted. One line, because the next line's
  // getstr would take the byte for itself - which is correct REPL behaviour.
  const stream = [];
  for (const ch of 'key? . key .\nX') sim.uartRxPush(ch === '\n' ? 13 : ch.charCodeAt(0));
  pump(200000, stream);
  const out = Buffer.from(stream).toString('latin1');
  assert.match(out, /key\? \. key \. -1 {2}88 {2}ok/,
               `key? should see the byte and key should take it: ${JSON.stringify(out)}`);
});

test('demo runs the starfield and stops on any key', () => {
  const stream = [];
  for (const ch of 'demo\n') sim.uartRxPush(ch === '\n' ? 13 : ch.charCodeAt(0));
  pump(2000000, stream);
  const running = Buffer.from(stream).toString('latin1');
  assert.ok(running.startsWith('demo\x1b[?1049h'), 'no alternate screen');
  assert.ok(!running.includes('\x1b[?1049l'), 'demo stopped before the key');

  const moves = [...running.matchAll(/\x1b\[(\d+);(\d+)H/g)];
  assert.ok(moves.length > 100, `only ${moves.length} cursor moves`);
  for (const m of moves) {
    assert.ok(+m[1] >= 1 && +m[1] <= 24, `row ${m[1]} off screen`);
    assert.ok(+m[2] >= 1 && +m[2] <= 79, `column ${m[2]} off screen (80 would wrap)`);
  }
  // No newline in the middle: the machine must not hard-wrap its own canvas.
  assert.equal((running.match(/\r\n/g) || []).length, 0);

  sim.uartRxPush(32);
  pump(2000000, stream);
  const out = Buffer.from(stream).toString('latin1');
  assert.ok(out.includes('\x1b[0m'), 'did not reset the attributes');
  assert.ok(out.includes('\x1b[?1049l'), 'did not leave the alternate screen');
  assert.match(out.slice(-40), /\r\n ok\r\n> $/);
});

test('asm/forth.asm carries the current forth/demo.fth', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'embed_forth.mjs'), '--check'],
               { cwd: ROOT, stdio: 'pipe' });
});
