// The D16nano console is the tile screen, but its output is mirrored to the
// UART so a serial terminal sees the same banner, prompt and typed echo.
// This boots the nano kernel, types a line into UART RX and checks the TX
// stream, without any tile renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, loadBrowserScripts, buildMemory, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const src = fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8');
const nano = assemble(src, { defines: { CONSOLE_UART: 1, D16NANO: 1 } });

function enterBios(fn, { uartStatus } = {}) {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(nano));
  sim.segmentRegisters.CS = 0xFFFF;
  sim.segmentRegisters.DS = 0x0000;
  sim.segmentRegisters.SS = 0x0000;
  sim.segmentRegisters.ES = 0x0000;
  sim.registers[0] = fn;
  sim.psw = 0x0020;                      // the handler's context, after SWI
  sim.shadowRegisters.CS = nano.symbols.bios_entry >> 4;
  sim.shadowRegisters.PC = 0;
  sim.shadowRegisters.DS = 0;
  sim.shadowRegisters.SS = 0;
  sim.shadowRegisters.ES = 0xF000;
  if (uartStatus !== undefined) sim.uartStatus = () => uartStatus;
  sim.running = true;
  for (let i = 0; i < 200000 && sim.running && (sim.psw & (1 << 5)) !== 0; i++) sim.step();
  return sim;
}

test('the D16nano kernel assembles with the UART mirror', () => {
  assert.ok(nano.success, nano.errors.join('; '));
  assert.notEqual(nano.symbols.uart_mirror, undefined, 'mirror helper is present');
});

test('the nano UART getch returns 0xFFFF without waiting', () => {
  const sim = enterBios(4);
  assert.equal(sim.shadowRegisters.R0 & 0xFFFF, 0xFFFF,
    'an idle getch must answer 0xFFFF, not spin in the BIOS');
});

test('the UART-ready primitive reports a full TX FIFO', () => {
  const busy = enterBios(nano.symbols.BIOS_UART_READY, { uartStatus: 0x08 });
  assert.equal(busy.shadowRegisters.R0 & 0xFFFF, 0,
    'TX-ready clear must answer busy without waiting');
  const ready = enterBios(nano.symbols.BIOS_UART_READY, { uartStatus: 0x0A });
  assert.equal(ready.shadowRegisters.R0 & 0xFFFF, 1, 'TX-ready set must answer ready');
});

test('typed UART input is echoed and evaluated on the terminal', () => {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(nano));
  // The console tests do not want the baked demo script.
  sim.memory[nano.symbols.boot_ptr] = 0;
  sim.segmentRegisters.CS = 0xFFFF;
  sim.segmentRegisters.DS = 0x0000;
  sim.segmentRegisters.SS = 0x0000;
  sim.segmentRegisters.ES = 0x0000;
  for (const ch of '2 3 + .\r') sim.uartRxPush(ch.charCodeAt(0));
  sim.running = true;

  let steps = 0;
  while (sim.running && steps < 3000000) {
    sim.step();
    steps++;
  }

  const tx = sim.uartTx.map((b) => String.fromCharCode(b)).join('');
  assert.match(tx, /Hello DeepForth!/, 'banner reached the UART');
  assert.match(tx, /2 3 \+ \./, 'typed line was echoed');
  assert.match(tx, /\b5\b/, 'the result reached the UART (and the tile screen)');
});
