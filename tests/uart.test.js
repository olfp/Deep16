// The JS core's UART console port (D16MINI.md §5): LDS/STS at 0xF0040/0xF0042.
// Drives executeLDSSTS directly, the way the existing keyboard-port behaviour
// is reachable, rather than assembling a program that has to set up ES first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserScripts } from './helpers.js';

loadBrowserScripts('js/deep16_simulator.js');
const { Deep16Simulator } = globalThis;

// LDS/STS: [11110][d][seg2][Rd4][Rs4]; seg 3 = ES.
const PREFIX = 0b11110;
function lds(rd, rs, seg = 3) {
  return ((PREFIX << 11) | (0 << 10) | (seg << 8) | (rd << 4) | rs) & 0xFFFF;
}
function sts(rd, rs, seg = 3) {
  return ((PREFIX << 11) | (1 << 10) | (seg << 8) | (rd << 4) | rs) & 0xFFFF;
}

function sim() {
  const s = new Deep16Simulator();
  s.segmentRegisters.ES = 0xF000;   // the console lives in the I/O segment
  return s;
}

test('a store to UART_DATA emits a byte', () => {
  const s = sim();
  s.registers[1] = 0x41;            // 'A'
  s.registers[2] = 0x0042;          // UART_DATA offset
  s.executeLDSSTS(sts(1, 2));
  assert.deepEqual(s.uartTx, [0x41]);
  assert.deepEqual(s.uartTxTake(), [0x41], 'take hands the byte over');
  assert.deepEqual(s.uartTxTake(), [], 'and clears the backlog');
});

test('reading UART_DATA pops the RX FIFO', () => {
  const s = sim();
  s.uartRxPush(0x5A);
  s.registers[2] = 0x0042;
  s.executeLDSSTS(lds(3, 2));
  assert.equal(s.registers[3], 0x5A);
  assert.equal(s.uartRxAvailable(), 0, 'the byte is consumed');
});

test('reading UART_STATUS reports RX-ready and TX-ready', () => {
  const s = sim();
  s.registers[2] = 0x0040;
  s.executeLDSSTS(lds(3, 2));
  assert.equal(s.registers[3] & 0x02, 0x02, 'TX-ready');
  assert.equal(s.registers[3] & 0x08, 0x08, 'TX-idle');
  assert.equal(s.registers[3] & 0x01, 0, 'no RX yet');
  s.uartRxPush(0x21);
  s.executeLDSSTS(lds(4, 2));
  assert.equal(s.registers[4] & 0x01, 0x01, 'RX-ready once a byte is queued');
});

test('writing UART_CTRL can flush the RX FIFO', () => {
  const s = sim();
  s.uartRxPush(0x31);
  s.registers[1] = 0x0001;
  s.registers[2] = 0x0046;          // UART_CTRL
  s.executeLDSSTS(sts(1, 2));
  assert.equal(s.uartRxAvailable(), 0);
});

test('the RX FIFO drops and flags an overrun when full', () => {
  const s = sim();
  for (let i = 0; i < s.UART_FIFO_DEPTH; i++) s.uartRxPush(i & 0xFF);
  s.uartRxPush(0xFF);              // one too many
  assert.equal(s.uartRxAvailable(), s.UART_FIFO_DEPTH, 'the FIFO stays at its depth');
  assert.equal(s.uartRxOverrun, true, 'the overrun is flagged');
  s.uartRxClear();
  assert.equal(s.uartRxOverrun, false);
});

test('reset clears the UART FIFOs and restores the divisor', () => {
  const s = sim();
  s.uartRxPush(0x41);
  s.uartTx.push(0x42);
  s.uartDiv = 7;
  s.reset();
  assert.equal(s.uartRxAvailable(), 0);
  assert.equal(s.uartTx.length, 0);
  assert.equal(s.uartDiv, 234);
});
