#!/usr/bin/env node
// scripts/make_ps2map.mjs - the PS/2 Set-2 scan-code character map.
//
// The receiver (rtl/ps2_rx.sv) addresses a 2048 x 8 BSRAM pROM with
//
//     {ctrl, caps, shift, scan_code[7:0]}
//
// and emits the byte when it is non-zero. Putting the table in BSRAM keeps the
// 104-key translation out of the logic budget; the pROM is one of the blocks
// the user-flash tile build leaves free.
//
// This is the **German (DE) QWERTZ** layout. Set-2 make codes are physical key
// positions, so y/z really are swapped: scan 0x35 (US Y) is German Z and scan
// 0x1A (US Z) is German Y. The printable set follows the German keycaps,
// including the Latin-1 umlauts (ä 0xE4, ö 0xF6, ü 0xFC, ß 0xDF). The font only
// has ASCII glyphs, so the console will not draw them, but programs that read
// the bytes get the real codes.
//
// Extended keys (the 0xE0 prefix) are decoded in logic, not in this table: they
// share make codes with the numeric keypad. rtl/ps2_rx.sv maps the arrows and
// Home/End to Emacs control bytes, and AltGr to the German punctuation that is
// not on a keycap (@ { [ ] } \ | ~). That keeps the map at 2048 entries.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PS2_MAP_WORDS = 2048;
export const PS2_MAP_FILE = 'ps2map.hex';

// scan code -> [unshifted, shifted]. Only keys that produce a character are
// listed; modifiers and prefixes stay zero.
export const KEYS = {
  // German letters: y and z are at each other's US positions.
  0x1c: ['a', 'A'], 0x32: ['b', 'B'], 0x21: ['c', 'C'], 0x23: ['d', 'D'],
  0x24: ['e', 'E'], 0x2b: ['f', 'F'], 0x34: ['g', 'G'], 0x33: ['h', 'H'],
  0x43: ['i', 'I'], 0x3b: ['j', 'J'], 0x42: ['k', 'K'], 0x4b: ['l', 'L'],
  0x3a: ['m', 'M'], 0x31: ['n', 'N'], 0x44: ['o', 'O'], 0x4d: ['p', 'P'],
  0x15: ['q', 'Q'], 0x2d: ['r', 'R'], 0x1b: ['s', 'S'], 0x2c: ['t', 'T'],
  0x3c: ['u', 'U'], 0x2f: ['v', 'V'], 0x1d: ['w', 'W'], 0x22: ['x', 'X'],
  0x35: ['z', 'Z'], 0x1a: ['y', 'Y'],

  0x45: ['0', '='], 0x16: ['1', '!'], 0x1e: ['2', '"'], 0x26: ['3', '§'],
  0x25: ['4', '$'], 0x2e: ['5', '%'], 0x36: ['6', '&'], 0x3d: ['7', '/'],
  0x3e: ['8', '('], 0x46: ['9', ')'],

  // German punctuation. The dead keys emit their spacing character.
  0x0e: ['^', '°'], 0x4e: ['ß', '?'], 0x55: ['´', '`'],
  0x54: ['ü', 'Ü'], 0x5b: ['+', '*'], 0x5d: ['#', "'"],
  0x4c: ['ö', 'Ö'], 0x52: ['ä', 'Ä'], 0x41: [',', ';'],
  0x49: ['.', ':'], 0x4a: ['-', '_'], 0x29: [' ', ' '],

  0x5a: ['\r', '\r'], 0x66: ['\b', '\b'], 0x0d: ['\t', '\t'],
  0x76: ['\x1b', '\x1b'],

  // Numeric keypad (Num Lock on). The extended navigation codes are decoded
  // in logic and must not collide with these make codes.
  0x70: ['0', '0'], 0x69: ['1', '1'], 0x72: ['2', '2'], 0x7a: ['3', '3'],
  0x6b: ['4', '4'], 0x73: ['5', '5'], 0x74: ['6', '6'], 0x6c: ['7', '7'],
  0x75: ['8', '8'], 0x7d: ['9', '9'], 0x71: ['.', '.'], 0x7c: ['*', '*'],
  0x7b: ['-', '-'], 0x79: ['+', '+'],
};

// AltGr characters, keyed by the original scan code. The decoder remaps those
// codes to the synthetic entries 0x80..0x8B, so the pROM address stays the
// plain {ctrl, caps, shift, code} and no mux sits on the BSRAM address pins.
export const ALTGR = {
  0x15: '@', 0x3d: '{', 0x3e: '[', 0x46: ']', 0x45: '}',
  0x4e: '\\', 0x41: '|', 0x5b: '~',
  0x1e: '²', 0x26: '³', 0x3a: 'µ', 0x24: '€',
};
export const ALTGR_BASE = 0x80;
// The order must match the case in rtl/ps2_rx.sv.
export const ALTGR_ORDER = [0x15, 0x3d, 0x3e, 0x46, 0x45, 0x4e, 0x41, 0x5b,
                            0x1e, 0x26, 0x3a, 0x24];

// E0-prefixed navigation keys. Arrow/Home/End emit the Emacs control bytes the
// console line editor expects when it grows one; the bytes are also useful to
// programs that read the raw keyboard FIFO.
export const EXT_BASE = 0x90;
export const EXT_ORDER = [0x6b, 0x74, 0x75, 0x72, 0x6c, 0x69];
export const EXT = {
  0x6b: 0x02,  // Left  -> C-B
  0x74: 0x06,  // Right -> C-F
  0x75: 0x10,  // Up    -> C-P
  0x72: 0x0e,  // Down  -> C-N
  0x6c: 0x01,  // Home  -> C-A
  0x69: 0x05,  // End   -> C-E
};

// Latin-1 uppercase pairs for the letters that are not ASCII a-z. Caps Lock
// and Shift both select the upper form, as on the keycaps.
const UPPER = { 'ä': 'Ä', 'ö': 'Ö', 'ü': 'Ü' };
const isLetter = (s) => /^[a-zäöü]$/.test(s);
const isAsciiLetter = (s) => /^[a-z]$/.test(s);

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
            const upper = UPPER[base] ?? base.toUpperCase();
            ch = (shift ^ caps) ? upper : base;
            if (ctrl) {
              // Ctrl+letter has a control code only for ASCII letters; the
              // German umlauts have none, so they emit nothing.
              ch = isAsciiLetter(base)
                ? String.fromCharCode(1 + base.charCodeAt(0) - 0x61)
                : '\0';
            }
          } else if (shift) {
            ch = shifted;
          }
          const addr = (ctrl << 10) | (caps << 9) | (shift << 8) | code;
          out[addr] = ch.charCodeAt(0) & 0xff;
        }
      }
    }
  }
  // AltGr characters at the synthetic codes, for every modifier combination.
  const fill = (dst, byte) => {
    for (let ctrl = 0; ctrl < 2; ctrl++) {
      for (let caps = 0; caps < 2; caps++) {
        for (let shift = 0; shift < 2; shift++) {
          out[(ctrl << 10) | (caps << 9) | (shift << 8) | dst] = byte & 0xff;
        }
      }
    }
  };
  ALTGR_ORDER.forEach((code, i) => fill(ALTGR_BASE + i, ALTGR[code].charCodeAt(0)));
  EXT_ORDER.forEach((code, i) => fill(EXT_BASE + i, EXT[code]));
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
