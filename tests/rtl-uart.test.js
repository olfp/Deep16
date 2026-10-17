// The serial console on the RTL core (D16MINI.md §4.4): the same UART kernel
// that runs on the JS core, booted on Verilator, with RX injected and TX read
// back through SerialTerminal. This is the three-core parity the terminal view
// depends on - before this, only the JS core spoke UART.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { assemble, loadBrowserScripts, loadRtl, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'deep16_terminal.js'), 'utf8'),
                    { filename: 'deep16_terminal.js' });
const SerialTerminal = vm.runInThisContext('SerialTerminal');

const src = fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8');
const uart = assemble(src, { defines: { CONSOLE_UART: 1 } });

async function boot(input, maxSteps = 60000) {
  const r = await loadRtl();
  r.init(1048576);
  for (const c of uart.memoryChanges) r.load_program(c.address, new Uint16Array([c.value & 0xFFFF]));
  r.set_segments(0xFFFF, 0x0000, 0x0000, 0x0000);
  for (const ch of input) r.uart_rx_push(ch === '\n' ? 13 : ch.charCodeAt(0));
  const term = new SerialTerminal();
  let steps = 0;
  while (steps < maxSteps) {
    r.step(); steps++;
    const bytes = r.uart_tx_take();
    if (bytes.length) term.writeBytes(bytes);
  }
  return { rows: term.text().map((x) => x.replace(/\s+$/, '')), steps };
}

test('the RTL core runs the serial kernel to the banner', async () => {
  const { rows } = await boot('');
  assert.equal(rows[0], 'Hello DeepForth!', `terminal was:\n${rows.join('\n')}`);
  assert.equal(rows[1], '>');
});

test('a line typed into the RTL UART is echoed and evaluated', async () => {
  const { rows } = await boot('3 4 + .\n');
  assert.equal(rows[1], '> 3 4 + . 7  ok', `terminal was:\n${rows.join('\n')}`);
});
