#!/usr/bin/env node
// scripts/make_ps2map.mjs - the PS/2 Set-2 scan-code to ASCII map.
//
// The receiver (rtl/ps2_rx.sv) addresses a 2048 x 8 BSRAM pROM with
//
//     {ctrl, caps, shift, scan_code[7:0]}
//
// and emits the byte when it is non-zero. Putting the table in BSRAM keeps the
// 104-key translation out of the logic budget; the pROM is one of the blocks
// the user-flash tile build leaves free.
//
// Set-2 make codes are the same whether Shift is held or not. Caps Lock only
// affects letters; Shift and Caps cancel each other for letters. Ctrl+letter
// becomes 0x01..0x1A, and the common Ctrl+punctuation codes are explicit.
// Extended (0xE0) keys are ignored by the decoder for now, which is why the
// map has no separate extended address bit: arrow keys must not collide with
// the numeric-keypad codes that share their make code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PS2_MAP_WORDS = 2048;
export const PS2_MAP_FILE = 'ps2map.hex';

// scan code -> [unshifted, shifted]. Only keys that produce a character are
// listed; modifiers and prefixes stay zero.
export const KEYS = {
  0x1c: ['a', 'A'], 0x32: ['b', 'B'], 0x21: ['c', 'C'], 0x23: ['d', 'D'],
  0x24: ['e', 'E'], 0x2b: ['f', 'F'], 0x34: ['g', 'G'], 0x33: ['h', 'H'],
  0x43: ['i', 'I'], 0x3b: ['j', 'J'], 0x42: ['k', 'K'], 0x4b: ['l', 'L'],
  0x3a: ['m', 'M'], 0x31: ['n', 'N'], 0x44: ['o', 'O'], 0x4d: ['p', 'P'],
  0x15: ['q', 'Q'], 0x2d: ['r', 'R'], 0x1b: ['s', 'S'], 0x2c: ['t', 'T'],
  0x3c: ['u', 'U'], 0x2a: ['v', 'V'], 0x1d: ['w', 'W'], 0x22: ['x', 'X'],
  0x35: ['y', 'Y'], 0x1a: ['z', 'Z'],

  0x45: ['0', ')'], 0x16: ['1', '!'], 0x1e: ['2', '@'], 0x26: ['3', '#'],
  0x25: ['4', '$'], 0x2e: ['5', '%'], 0x36: ['6', '^'], 0x3d: ['7', '&'],
  0x3e: ['8', '*'], 0x46: ['9', '('],

  0x0e: ['`', '~'], 0x4e: ['-', '_'], 0x55: ['=', '+'],
  0x54: ['[', '{'], 0x5b: [']', '}'], 0x5d: ['\\', '|'],
  0x4c: [';', ':'], 0x52: ["'", '"'], 0x41: [',', '<'],
  0x49: ['.', '>'], 0x4a: ['/', '?'], 0x29: [' ', ' '],

  0x5a: ['\r', '\r'], 0x66: ['\b', '\b'], 0x0d: ['\t', '\t'],
  0x76: ['\x1b', '\x1b'],

  // Numeric keypad (Num Lock on). The extended navigation codes are ignored.
  0x70: ['0', '0'], 0x69: ['1', '1'], 0x72: ['2', '2'], 0x7a: ['3', '3'],
  0x6b: ['4', '4'], 0x73: ['5', '5'], 0x74: ['6', '6'], 0x6c: ['7', '7'],
  0x75: ['8', '8'], 0x7d: ['9', '9'], 0x71: ['.', '.'], 0x7c: ['*', '*'],
  0x7b: ['-', '-'], 0x79: ['+', '+'],
};

// Ctrl+key overrides. Letters are computed, these are the punctuation keys
// whose control code is not the base character.
const CTRL = {
  0x54: 0x1b, // Ctrl+[      ESC
  0x5d: 0x1c, // Ctrl+\      FS
  0x5b: 0x1d, // Ctrl+]      GS
  0x36: 0x1e, // Ctrl+6/^    RS
  0x4e: 0x1f, // Ctrl+-/_    US
  0x1e: 0x00, // Ctrl+2/@    NUL (no byte is emitted)
};

const isLetter = (s) => /^[a-z]$/.test(s);

// Build the 2048-entry table. Address bit 10 = Ctrl, 9 = Caps, 8 = Shift.
export function ps2MapWords() {
  const out = new Uint8Array(PS2_MAP_WORDS);
  for (const [codeText, pair] of Object.entries(KEYS)) {
    const code = Number(codeText);
    const [base, shifted] = pair;
    const letter = isLetter(base);
    for (let ctrl = 0; ctrl < 2; ctrl++) {
      for (let caps = 0; caps < 2; caps++) {
        for (let shift = 0; shift < 2; shift++) {
          let ch = base;
          if (letter) {
            ch = (shift ^ caps) ? base.toUpperCase() : base;
            if (ctrl) ch = String.fromCharCode(1 + base.charCodeAt(0) - 0x61);
          } else if (ctrl && Object.prototype.hasOwnProperty.call(CTRL, code)) {
            ch = String.fromCharCode(CTRL[code]);
          } else if (shift) {
            ch = shifted;
          }
          const addr = (ctrl << 10) | (caps << 9) | (shift << 8) | code;
          out[addr] = ch.charCodeAt(0) & 0xff;
        }
      }
    }
  }
  return out;
}

// Convenience for tests and debugging.
export function ps2MapLookup(code, { ctrl = false, caps = false, shift = false } = {}) {
  return ps2MapWords()[(ctrl ? 1024 : 0) | (caps ? 512 : 0) | (shift ? 256 : 0) | (code & 0xff)];
}

export function writePs2Map(outDir) {
  const words = ps2MapWords();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, PS2_MAP_FILE),
                   Array.from(words).map((b) => b.toString(16).padStart(2, '0')).join('\n') + '\n');
  return words.length;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = path.resolve(process.argv[2] ?? path.join(ROOT, 'artifacts', 'image'));
  const n = writePs2Map(out);
  console.log(`wrote ${path.relative(ROOT, out)}/${PS2_MAP_FILE} (${n} entries, ` +
              `${Object.keys(KEYS).length} keys, Ctrl/Caps/Shift addressed)`);
}
