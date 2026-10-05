// The shipped example programs must keep assembling and running.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, loadBrowserScripts, runJs, readScreen, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const ASM_DIR = path.join(ROOT, 'asm');
const EXAMPLES = fs.readdirSync(ASM_DIR).filter(f => f.endsWith('.asm')).sort();

test('the expected examples are present', () => {
  assert.deepEqual(EXAMPLES, [
    'far_call.asm',
    'fibonacci.asm',
    'forth.asm',
    'link_delay_slot.asm',
    'screen_demo.asm',
    'string_demo.asm',
    'swi-test.asm',
  ]);
});

for (const file of EXAMPLES) {
  test(`${file} assembles`, () => {
    const src = fs.readFileSync(path.join(ASM_DIR, file), 'utf8');
    const res = assemble(src);
    assert.equal(res.success, true, res.errors.join('; '));
    assert.ok(res.memoryChanges.length > 0, 'no words were emitted');
  });

  // forth.asm is a REPL: it prints its banner and then waits for keyboard
  // input, so it never reaches HALT. It only has to keep running.
  const mustHalt = file !== 'forth.asm';

  test(`${file} runs`, () => {
    const src = fs.readFileSync(path.join(ASM_DIR, file), 'utf8');
    const res = assemble(src);
    assert.equal(res.success, true, res.errors.join('; '));
    const { sim, steps } = runJs(res, { maxSteps: 200000 });
    if (mustHalt) {
      assert.equal(sim.running, false, `${file} did not halt within the step limit`);
    }
    assert.ok(steps > 0);
  });
}

test('fibonacci writes F(0)..F(10) to memory', () => {
  const src = fs.readFileSync(path.join(ASM_DIR, 'fibonacci.asm'), 'utf8');
  const { memory } = runJs(assemble(src));
  const out = [];
  for (let i = 0; i < 11; i++) out.push(memory[0x0200 + i] & 0xFFFF);
  assert.deepEqual(out, [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]);
});

test('string_demo prints its greeting to the screen', () => {
  const src = fs.readFileSync(path.join(ASM_DIR, 'string_demo.asm'), 'utf8');
  const { memory } = runJs(assemble(src));
  assert.match(readScreen(memory), /Hello, Deep16!/);
});

test('swi-test prints the OS version banner', () => {
  const src = fs.readFileSync(path.join(ASM_DIR, 'swi-test.asm'), 'utf8');
  const { memory } = runJs(assemble(src));
  assert.match(readScreen(memory), /SWI Version Demo/);
});

test('the Forth kernel greets and stays in its REPL loop', () => {
  const src = fs.readFileSync(path.join(ASM_DIR, 'forth.asm'), 'utf8');
  const { memory, sim, steps } = runJs(assemble(src), { maxSteps: 200000 });
  assert.match(readScreen(memory), /Hello DeepForth!/);
  // It is waiting for keyboard input, so it is still running and burning steps.
  assert.equal(sim.running, true);
  assert.ok(steps > 1000, `expected the REPL to keep executing, stopped after ${steps} steps`);
});